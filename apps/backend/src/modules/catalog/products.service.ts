import { slugify } from '@encuanto/contracts';
import {
  brands,
  categories,
  products,
  productVariants,
  type DbExecutor,
  type VariantAttributes,
} from '@encuanto/db';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { brandKey, normalizeGtin } from '../normalization/index';

/**
 * Altas sueltas del catálogo que usa el matching (H3) cuando una oferta no tiene ficha (§8.2
 * nivel 5) o es una variante nueva de una ficha existente. Aceptan una transacción abierta: el
 * matching crea la ficha y enlaza la oferta en la misma transacción.
 */

/** Marca por su nombre normalizado; la crea con `displayName` si no existe. Devuelve su id. */
export async function ensureBrand(
  db: DbExecutor,
  normalizedName: string,
  displayName: string,
): Promise<string | null> {
  const key = brandKey(normalizedName);
  if (!key) return null;
  await db
    .insert(brands)
    .values({ normalizedName: key, name: displayName.trim() || key })
    .onConflictDoNothing({ target: brands.normalizedName });
  const [row] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.normalizedName, key));
  return row?.id ?? null;
}

/**
 * Categoría por slug; la crea si no existe sin tocar el indicador de accesorio de una existente.
 * Devuelve su id, o null si el nombre no da un slug.
 */
export async function ensureCategory(db: DbExecutor, name: string): Promise<string | null> {
  const clean = name.trim().slice(0, 120);
  const slug = slugify(clean);
  if (!slug) return null;
  await db
    .insert(categories)
    .values({ slug, name: clean })
    .onConflictDoNothing({ target: categories.slug });
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug));
  return row?.id ?? null;
}

export interface NewProductInput {
  brandId: string | null;
  categoryId: string | null;
  canonicalName: string;
  modelNumber: string | null;
}

export async function createProduct(db: DbExecutor, input: NewProductInput): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      brandId: input.brandId,
      categoryId: input.categoryId,
      canonicalName: input.canonicalName,
      modelNumber: input.modelNumber,
    })
    .returning({ id: products.id });
  return row!.id;
}

export interface NewVariantInput {
  productId: string;
  gtin: string | null;
  attributes: VariantAttributes;
  imageUrl: string | null;
}

/** Crea una variante. El GTIN se guarda normalizado a 14 dígitos (o nulo si no es válido). */
export async function createVariant(db: DbExecutor, input: NewVariantInput): Promise<string> {
  const [row] = await db
    .insert(productVariants)
    .values({
      productId: input.productId,
      gtin: normalizeGtin(input.gtin),
      attributes: input.attributes,
      imageUrl: input.imageUrl,
    })
    .returning({ id: productVariants.id });
  return row!.id;
}

/** Si alguna variante ya usa ese GTIN (normalizado). */
export async function gtinInUse(db: DbExecutor, gtin: string | null): Promise<boolean> {
  const normalized = normalizeGtin(gtin);
  if (!normalized) return false;
  const [row] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.gtin, normalized))
    .limit(1);
  return !!row;
}

/**
 * Completa el GTIN de una variante que no lo tiene, si ninguna otra variante lo usa. Devuelve si
 * lo escribió. Solo lo llama el matching con enlaces de nivel 2 (marca + modelo + atributos).
 */
export async function fillVariantGtin(
  db: DbExecutor,
  variantId: string,
  gtin: string,
): Promise<boolean> {
  const normalized = normalizeGtin(gtin);
  if (!normalized) return false;
  const other = db
    .select({ one: sql`1` })
    .from(productVariants)
    .where(eq(productVariants.gtin, normalized));
  const rows = await db
    .update(productVariants)
    .set({ gtin: normalized, updatedAt: sql`now()` })
    .where(and(eq(productVariants.id, variantId), isNull(productVariants.gtin), notExists(other)))
    .returning({ id: productVariants.id });
  return rows.length > 0;
}
