import { productVariants, type DbExecutor } from '@encuanto/db';
import { asc, inArray, sql } from 'drizzle-orm';
import { MAX_SIMILAR_PRODUCTS, RECALL_SIMILARITY } from './candidates';
import type { CandidateProduct, MatchCandidates, MatchOffer } from './rules';
import type { PreparedTitle } from './title';

interface ProductRow extends Record<string, unknown> {
  id: string;
  brand: string | null;
  canonical_name: string;
  model_number: string | null;
  accessory: boolean | null;
}

const productColumns = sql`p.id, b.normalized_name as brand, p.canonical_name, p.model_number,
  c.accessory`;
const productJoins = sql`from products p
  left join brands b on b.id = p.brand_id
  left join categories c on c.id = p.category_id`;

async function withVariants(db: DbExecutor, rows: ProductRow[]): Promise<CandidateProduct[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const variants = await db
    .select({
      id: productVariants.id,
      product_id: productVariants.productId,
      gtin: productVariants.gtin,
      attributes: productVariants.attributes,
    })
    .from(productVariants)
    .where(inArray(productVariants.productId, ids))
    .orderBy(asc(productVariants.createdAt), asc(productVariants.id));
  const byProduct = new Map<string, CandidateProduct['variants']>();
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push({ id: v.id, gtin: v.gtin, attributes: v.attributes });
    byProduct.set(v.product_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    canonicalName: r.canonical_name,
    modelNumber: r.model_number,
    accessoryCategory: !!r.accessory,
    variants: byProduct.get(r.id) ?? [],
  }));
}

/**
 * Candidatos de una oferta en la BD (§8.2), con las mismas reglas que `candidatesInMemory`.
 * Debe llamarse dentro de una transacción: fija `pg_trgm.similarity_threshold` con `set local`
 * para que el operador `%` use el índice de trigramas con el umbral de recuperación.
 */
export async function findCandidates(
  tx: DbExecutor,
  offer: MatchOffer,
  title: PreparedTitle,
): Promise<MatchCandidates & { capped: boolean }> {
  let gtin: MatchCandidates['gtin'] = null;
  if (offer.gtin) {
    const rows = await tx.execute<ProductRow & { variant_id: string }>(sql`
      select ${productColumns}, v.id as variant_id
        from product_variants v
        join products p on p.id = v.product_id
        left join brands b on b.id = p.brand_id
        left join categories c on c.id = p.category_id
       where v.gtin = ${offer.gtin}`);
    const row = rows[0];
    if (row) {
      const [product] = await withVariants(tx, [row]);
      const variant = product!.variants.find((v) => v.id === row.variant_id)!;
      gtin = { product: product!, variant };
    }
  }

  let model: CandidateProduct[] = [];
  if (offer.brand && title.modelKey) {
    const rows = await tx.execute<ProductRow>(sql`
      select ${productColumns} ${productJoins}
       where b.normalized_name = ${offer.brand}
         and regexp_replace(upper(p.model_number), '[^A-Z0-9]', '', 'g') = ${title.modelKey}
       order by p.created_at, p.id`);
    model = await withVariants(tx, [...rows]);
  }

  // `set_config(..., true)` equivale a `set local`: solo dura la transacción.
  await tx.execute(
    sql`select set_config('pg_trgm.similarity_threshold', ${String(RECALL_SIMILARITY)}, true)`,
  );
  const similarRows = await tx.execute<ProductRow>(sql`
    select ${productColumns} ${productJoins}
     where public.immutable_unaccent(lower(p.canonical_name)) % ${title.core}
       and (${offer.brand}::text is null or b.normalized_name is null or b.normalized_name = ${offer.brand})
     order by similarity(public.immutable_unaccent(lower(p.canonical_name)), ${title.core}) desc, p.id
     limit ${MAX_SIMILAR_PRODUCTS + 1}`);
  const capped = similarRows.length > MAX_SIMILAR_PRODUCTS;
  const similar = await withVariants(tx, [...similarRows].slice(0, MAX_SIMILAR_PRODUCTS));
  return { gtin, model, similar, capped };
}
