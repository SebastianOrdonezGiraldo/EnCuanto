import { FRESHNESS_HIDDEN_HOURS } from '@encuanto/contracts';
import type { DbClient } from '@encuanto/db';
import type { Candidate, LiveOffer } from './rank';

type Sql = DbClient['sql'];

/** Máximo de productos candidatos que salen de la BD por consulta de texto. */
export const MAX_CANDIDATES = 1500;
/** Penalización de accesorio (§8.3). */
export const ACCESSORY_PENALTY = 0.5;

export interface TextCandidatesInput {
  tsquery: string | null;
  normalized: string;
  accessory: boolean;
  wText: number;
  wTrgm: number;
}

interface CandidateRow {
  product_id: string;
  text_score: number;
  brand_key: string | null;
  brand_name: string | null;
}

const toCandidate = (r: CandidateRow): Candidate => ({
  productId: r.product_id,
  textScore: Number(r.text_score),
  brandKey: r.brand_key,
  brandName: r.brand_name,
});

/**
 * Productos que coinciden con el texto y su puntuación de §8.3:
 *
 *   ts_rank_cd(search_tsv, query)·w_text + similarity(nombre, q)·w_trgm − penalización de accesorio
 *
 * Entran por FTS en español (índice GIN de `search_tsv`) o por similitud de palabra con
 * trigramas (`<%`, índice GIN sobre el nombre sin tildes), que tolera errores de escritura.
 * La bonificación por stock y el umbral se aplican después, con las ofertas (rank.ts).
 */
export async function findTextCandidates(
  sql: Sql,
  input: TextCandidatesInput,
): Promise<Candidate[]> {
  if (!input.normalized) return [];
  const rows = await sql<CandidateRow[]>`
    with q as (
      select ${input.tsquery ? sql`to_tsquery('spanish', ${input.tsquery})` : sql`null::tsquery`} as tsq,
             ${input.normalized}::text as text
    )
    select p.id as product_id,
           (coalesce(ts_rank_cd(p.search_tsv, q.tsq), 0) * ${input.wText}::float8
            + similarity(public.immutable_unaccent(lower(p.canonical_name)), q.text) * ${input.wTrgm}::float8
            - case when c.accessory and not ${input.accessory}::boolean
                   then ${ACCESSORY_PENALTY}::float8 else 0 end)::float8 as text_score,
           b.normalized_name as brand_key,
           b.name as brand_name
      from products p
      cross join q
      left join categories c on c.id = p.category_id
      left join brands b on b.id = p.brand_id
     where (q.tsq is not null and p.search_tsv @@ q.tsq)
        or q.text <% public.immutable_unaccent(lower(p.canonical_name))
     order by text_score desc, p.id
     limit ${MAX_CANDIDATES}`;
  return rows.map(toCandidate);
}

/** Productos de una categoría (listado sin texto: puntuación 0). */
export async function findCategoryCandidates(sql: Sql, categoryId: string): Promise<Candidate[]> {
  const rows = await sql<CandidateRow[]>`
    select p.id as product_id, 0::float8 as text_score,
           b.normalized_name as brand_key, b.name as brand_name
      from products p
      left join brands b on b.id = p.brand_id
     where p.category_id = ${categoryId}`;
  return rows.map(toCandidate);
}

/** Productos con alguna oferta vigente de una tienda (listado sin texto). */
export async function findMerchantCandidates(sql: Sql, merchantId: string): Promise<Candidate[]> {
  const rows = await sql<CandidateRow[]>`
    select distinct p.id as product_id, 0::float8 as text_score,
           b.normalized_name as brand_key, b.name as brand_name
      from offers o
      join product_variants v on v.id = o.variant_id
      join products p on p.id = v.product_id
      left join brands b on b.id = p.brand_id
     where o.merchant_id = ${merchantId}
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})`;
  return rows.map(toCandidate);
}

interface OfferRow {
  product_id: string;
  offer_id: string;
  variant_id: string;
  merchant: string;
  merchant_name: string;
  price: number;
  list_price: number | null;
  availability: LiveOffer['availability'];
  last_seen_at: Date | string;
}

/**
 * Ofertas vigentes de los productos dados (§8.5): tienda activa, en COP y vistas hace ≤ 72 h.
 * `merchantId` restringe a una tienda (listado de tienda).
 */
export async function findLiveOffers(
  sql: Sql,
  productIds: readonly string[],
  merchantId: string | null = null,
): Promise<LiveOffer[]> {
  if (productIds.length === 0) return [];
  const rows = await sql<OfferRow[]>`
    select v.product_id, o.id as offer_id, o.variant_id, m.slug as merchant, m.name as merchant_name,
           o.price::float8 as price, o.list_price::float8 as list_price, o.availability, o.last_seen_at
      from product_variants v
      join offers o on o.variant_id = v.id
      join merchants m on m.id = o.merchant_id
     where v.product_id = any(${productIds as string[]}::uuid[])
       and m.active
       and o.currency = 'COP'
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})
       and (${merchantId}::uuid is null or o.merchant_id = ${merchantId}::uuid)`;
  return rows.map((r) => ({
    productId: r.product_id,
    offerId: r.offer_id,
    variantId: r.variant_id,
    merchant: r.merchant,
    merchantName: r.merchant_name,
    price: Number(r.price),
    listPrice: r.list_price === null ? null : Number(r.list_price),
    availability: r.availability,
    lastSeenAt: new Date(r.last_seen_at),
  }));
}

export interface ProductDetails {
  id: string;
  name: string;
  brand: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  imageUrl: string | null;
}

export interface OfferDetails {
  id: string;
  merchant: string;
  merchantName: string;
  price: number;
  listPrice: number | null;
  availability: LiveOffer['availability'];
  imageUrl: string | null;
  lastSeenAt: Date;
}

/** Datos para pintar una página de resultados (solo los ~24 productos de la página). */
export async function hydrate(
  sql: Sql,
  productIds: readonly string[],
  offerIds: readonly string[],
): Promise<{ products: Map<string, ProductDetails>; offers: Map<string, OfferDetails> }> {
  if (productIds.length === 0) return { products: new Map(), offers: new Map() };
  const [productRows, offerRows] = await Promise.all([
    sql<
      {
        id: string;
        name: string;
        brand: string | null;
        category_slug: string | null;
        category_name: string | null;
        image_url: string | null;
      }[]
    >`
      select p.id, p.canonical_name as name, b.name as brand,
             c.slug as category_slug, c.name as category_name,
             (select v.image_url from product_variants v
               where v.product_id = p.id and v.image_url is not null
               order by v.created_at limit 1) as image_url
        from products p
        left join brands b on b.id = p.brand_id
        left join categories c on c.id = p.category_id
       where p.id = any(${productIds as string[]}::uuid[])`,
    sql<
      {
        id: string;
        merchant: string;
        merchant_name: string;
        price: number;
        list_price: number | null;
        availability: LiveOffer['availability'];
        image_url: string | null;
        last_seen_at: Date | string;
      }[]
    >`
      select o.id, m.slug as merchant, m.name as merchant_name, o.price::float8 as price,
             o.list_price::float8 as list_price, o.availability, o.image_url, o.last_seen_at
        from offers o
        join merchants m on m.id = o.merchant_id
       where o.id = any(${offerIds as string[]}::uuid[])`,
  ]);
  return {
    products: new Map(
      productRows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          brand: r.brand,
          categorySlug: r.category_slug,
          categoryName: r.category_name,
          imageUrl: r.image_url,
        },
      ]),
    ),
    offers: new Map(
      offerRows.map((r) => [
        r.id,
        {
          id: r.id,
          merchant: r.merchant,
          merchantName: r.merchant_name,
          price: Number(r.price),
          listPrice: r.list_price === null ? null : Number(r.list_price),
          availability: r.availability,
          imageUrl: r.image_url,
          lastSeenAt: new Date(r.last_seen_at),
        },
      ]),
    ),
  };
}

export async function getCategoryBySlug(
  sql: Sql,
  slug: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const [row] = await sql<{ id: string; slug: string; name: string }[]>`
    select id, slug, name from categories where slug = ${slug}`;
  return row ?? null;
}

export async function getActiveMerchantBySlug(
  sql: Sql,
  slug: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const [row] = await sql<{ id: string; slug: string; name: string }[]>`
    select id, slug, name from merchants where slug = ${slug} and active`;
  return row ?? null;
}

/** Categorías con al menos un producto con oferta vigente (navegación y sitemap). */
export async function listCategoriesWithProducts(
  sql: Sql,
): Promise<{ slug: string; name: string; product_count: number }[]> {
  return sql<{ slug: string; name: string; product_count: number }[]>`
    select c.slug, c.name, count(distinct p.id)::int as product_count
      from categories c
      join products p on p.category_id = c.id
      join product_variants v on v.product_id = p.id
      join offers o on o.variant_id = v.id
      join merchants m on m.id = o.merchant_id
     where m.active
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})
     group by c.slug, c.name
     order by c.name`;
}

/** Tiendas activas con ofertas vigentes en el catálogo (navegación y sitemap). */
export async function listActiveMerchants(
  sql: Sql,
): Promise<{ slug: string; name: string; offer_count: number }[]> {
  return sql<{ slug: string; name: string; offer_count: number }[]>`
    select m.slug, m.name, count(*)::int as offer_count
      from merchants m
      join offers o on o.merchant_id = m.id
     where m.active
       and o.variant_id is not null
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})
     group by m.slug, m.name
     order by m.name`;
}
