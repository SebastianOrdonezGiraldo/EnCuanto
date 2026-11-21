import { slugify } from '@encuanto/contracts';
import {
  brands,
  categories,
  products,
  productVariants,
  type Database,
  type VariantAttributes,
} from '@encuanto/db';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { brandKey, normalizeGtin } from '../normalization/index';

/** Variante de una ficha que se quiere registrar. `key` la identifica en el resultado. */
export interface CatalogVariantInput {
  key: string;
  gtin: string | null;
  attributes: VariantAttributes;
  imageUrl?: string | null;
}

/** Producto (modelo) con su categoría, marca y variantes (§6). */
export interface CatalogEntryInput {
  category: { name: string; accessory?: boolean };
  brand: string | null;
  canonicalName: string;
  modelNumber: string | null;
  variants: CatalogVariantInput[];
}

/** Lotes para no pasar del límite de parámetros de PostgreSQL. */
const CHUNK = 1000;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** JSON con claves ordenadas, para comparar atributos guardados en jsonb. */
function stableAttributes(attributes: VariantAttributes): string {
  const obj = attributes as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  );
}

const productKey = (
  brandId: string | null,
  categoryId: string | null,
  name: string,
  model: string | null,
) => `${brandId ?? '-'}|${categoryId ?? '-'}|${model ? `m:${model}` : `n:${name.toLowerCase()}`}`;

/**
 * Registra categorías, productos y variantes de forma idempotente y devuelve el id de cada
 * variante por su `key`.
 *
 * Identidad: la categoría por slug; el producto por (marca, categoría, modelo) o, sin modelo,
 * por (marca, categoría, nombre); la variante por GTIN o, sin GTIN, por (producto, atributos).
 *
 * Lo usa el seed sintético, que conoce la ficha de cada oferta. El matching (H3) crea las fichas
 * una a una con `createProduct` y `createVariant`.
 */
export async function upsertCatalog(
  db: Database,
  entries: readonly CatalogEntryInput[],
): Promise<Map<string, string>> {
  const variantIds = new Map<string, string>();
  if (entries.length === 0) return variantIds;

  // 1. Categorías por slug. `accessory` solo se cambia si la entrada lo indica: omitirlo no
  // debe quitarle a una categoría existente la penalización de accesorio (§8.3).
  const categoryInputs = [
    ...new Map(entries.map((e) => [slugify(e.category.name), e.category])).entries(),
  ];
  const categoryId = new Map<string, string>();
  for (const withFlag of [true, false]) {
    const values = categoryInputs
      .filter(([, c]) => (c.accessory !== undefined) === withFlag)
      .map(([slug, c]) => ({ slug, name: c.name, accessory: !!c.accessory }));
    if (values.length === 0) continue;
    const rows = await db
      .insert(categories)
      .values(values)
      .onConflictDoUpdate({
        target: categories.slug,
        set: withFlag
          ? { name: sql`excluded.name`, accessory: sql`excluded.accessory` }
          : { name: sql`excluded.name` },
      })
      .returning({ id: categories.id, slug: categories.slug });
    for (const r of rows) categoryId.set(r.slug, r.id);
  }

  // 2. Marcas por nombre normalizado.
  const brandNames = [...new Set(entries.map((e) => e.brand).filter((b): b is string => !!b))];
  const brandValues = [...new Map(brandNames.map((n) => [brandKey(n), n])).entries()]
    .filter(([key]) => key)
    .map(([normalizedName, name]) => ({ name, normalizedName }));
  if (brandValues.length > 0) {
    await db
      .insert(brands)
      .values(brandValues)
      .onConflictDoNothing({ target: brands.normalizedName });
  }
  const brandId = new Map<string, string>();
  for (const part of chunks(brandValues.map((b) => b.normalizedName))) {
    const rows = await db
      .select({ id: brands.id, key: brands.normalizedName })
      .from(brands)
      .where(inArray(brands.normalizedName, part));
    for (const r of rows) brandId.set(r.key, r.id);
  }

  // 3. Productos: se reutilizan los existentes con la misma identidad.
  const resolved = entries.map((e) => {
    const b = e.brand ? (brandId.get(brandKey(e.brand)) ?? null) : null;
    const c = categoryId.get(slugify(e.category.name)) ?? null;
    return {
      entry: e,
      brandId: b,
      categoryId: c,
      key: productKey(b, c, e.canonicalName, e.modelNumber),
    };
  });
  // Se buscan por la misma identidad que define `productKey`: el modelo si lo hay (aunque el
  // nombre haya cambiado) o el nombre sin distinguir mayúsculas.
  const productId = new Map<string, string>();
  const models = [
    ...new Set(resolved.map((r) => r.entry.modelNumber).filter((m): m is string => !!m)),
  ];
  const names = [
    ...new Set(
      resolved.filter((r) => !r.entry.modelNumber).map((r) => r.entry.canonicalName.toLowerCase()),
    ),
  ];
  const lookups = [
    ...chunks(models).map((part) => inArray(products.modelNumber, part)),
    ...chunks(names).map((part) =>
      and(isNull(products.modelNumber), inArray(sql`lower(${products.canonicalName})`, part)),
    ),
  ];
  for (const where of lookups) {
    const rows = await db
      .select({
        id: products.id,
        brandId: products.brandId,
        categoryId: products.categoryId,
        name: products.canonicalName,
        model: products.modelNumber,
      })
      .from(products)
      .where(where);
    for (const r of rows) productId.set(productKey(r.brandId, r.categoryId, r.name, r.model), r.id);
  }
  const missing = [
    ...new Map(resolved.filter((r) => !productId.has(r.key)).map((r) => [r.key, r])).values(),
  ];
  for (const part of chunks(missing)) {
    const rows = await db
      .insert(products)
      .values(
        part.map((r) => ({
          brandId: r.brandId,
          categoryId: r.categoryId,
          canonicalName: r.entry.canonicalName,
          modelNumber: r.entry.modelNumber,
        })),
      )
      .returning({ id: products.id });
    rows.forEach((row, i) => productId.set(part[i]!.key, row.id));
  }

  // 4. Variantes: por GTIN (único) o por (producto, atributos).
  const wanted = resolved.flatMap((r) =>
    // GTIN en 14 dígitos, como lo guarda la ingesta (normalizeGtin): así el matching de nivel 1
    // encuentra la variante. Uno inválido se descarta.
    r.entry.variants.map((v) => ({
      ...v,
      gtin: normalizeGtin(v.gtin),
      productId: productId.get(r.key)!,
    })),
  );
  const byGtin = new Map<string, string>();
  const byAttrs = new Map<string, string>();
  const productIds = [...new Set(wanted.map((v) => v.productId))];
  for (const part of chunks(productIds)) {
    const rows = await db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        gtin: productVariants.gtin,
        attributes: productVariants.attributes,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, part));
    for (const r of rows) {
      if (r.gtin) byGtin.set(r.gtin, r.id);
      byAttrs.set(`${r.productId}|${stableAttributes(r.attributes)}`, r.id);
    }
  }
  const gtins = wanted.map((v) => v.gtin).filter((g): g is string => !!g && !byGtin.has(g));
  for (const part of chunks(gtins)) {
    // Un GTIN puede estar ya en una variante de otro producto: se respeta la existente.
    const rows = await db
      .select({ id: productVariants.id, gtin: productVariants.gtin })
      .from(productVariants)
      .where(inArray(productVariants.gtin, part));
    for (const r of rows) byGtin.set(r.gtin!, r.id);
  }

  const lookup = (v: (typeof wanted)[number]) =>
    v.gtin ? byGtin.get(v.gtin) : byAttrs.get(`${v.productId}|${stableAttributes(v.attributes)}`);
  const toInsert = [
    ...new Map(
      wanted
        .filter((v) => !lookup(v))
        .map((v) => [v.gtin ?? `${v.productId}|${stableAttributes(v.attributes)}`, v]),
    ).values(),
  ];
  for (const part of chunks(toInsert)) {
    const rows = await db
      .insert(productVariants)
      .values(
        part.map((v) => ({
          productId: v.productId,
          gtin: v.gtin,
          attributes: v.attributes,
          imageUrl: v.imageUrl ?? null,
        })),
      )
      .returning({
        id: productVariants.id,
        productId: productVariants.productId,
        gtin: productVariants.gtin,
        attributes: productVariants.attributes,
      });
    for (const r of rows) {
      if (r.gtin) byGtin.set(r.gtin, r.id);
      else byAttrs.set(`${r.productId}|${stableAttributes(r.attributes)}`, r.id);
    }
  }

  for (const v of wanted) {
    const id = lookup(v);
    if (id) variantIds.set(v.key, id);
  }
  return variantIds;
}
