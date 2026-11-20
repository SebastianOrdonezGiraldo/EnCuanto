import { FRESHNESS_HIDDEN_HOURS } from '@encuanto/contracts';
import type { DbClient } from '@encuanto/db';
import type { Candidate, LiveOffer, MerchantGroup } from './rank';

type Sql = DbClient['sql'];

/** Máximo de productos candidatos que salen de la BD por consulta de texto. */
export const MAX_CANDIDATES = 1500;
/** Penalización de accesorio (§8.3). */
export const ACCESSORY_PENALTY = 0.5;

export interface TextCandidatesInput {
  tsquery: string | null;
  normalized: string;
  /** Marca reconocida en la consulta (`brands.normalized_name`), o null. */
  brand: string | null;
  accessory: boolean;
  wText: number;
  wTrgm: number;
}

/** De dónde salen los productos de un listado. */
export type ListingSource =
  | { kind: 'text'; input: TextCandidatesInput }
  | { kind: 'category'; categoryId: string }
  | { kind: 'merchant'; merchantId: string };

interface ListingRow {
  product_id: string;
  text_score: number;
  brand_key: string | null;
  brand_name: string | null;
  merchant: string;
  merchant_name: string;
  best_id: string;
  best_price: number;
  best_list_price: number | null;
  best_oos: boolean;
  best_seen_ms: number;
  max_buyable: number | null;
  max_all: number;
  offer_count: number;
  in_stock: boolean;
}

/** Condición de oferta vigente (§8.5) sobre `offers o` y `merchants m`. */
const liveOffer = (sql: Sql) => sql`
  m.active
  and o.currency = 'COP'
  and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})`;

/**
 * Candidatos de un listado y, por cada (producto, tienda), el resumen de sus ofertas vigentes,
 * en una sola consulta. La agregación por tienda reduce las filas que viajan a Node (y el trabajo
 * del ranking) a ~productos × tiendas; `groupOffers` en rank.ts es su equivalente en TypeScript.
 *
 * Texto (§8.3): entran por FTS en español (índice GIN de `search_tsv`), por similitud de
 * palabra con trigramas (`<%`, índice GIN sobre el nombre sin tildes) o, si la consulta nombra
 * una marca conocida, por ser de esa marca (la marca vive en `brands`, no siempre en el nombre).
 * Puntúan
 *
 *   ts_rank_cd(documento, query)·w_text + similarity(nombre, q)·w_trgm − penalización de accesorio
 *
 * donde el documento es `search_tsv` más la marca del producto cuando es la de la consulta.
 *
 * La bonificación por stock y el umbral se aplican después, en rank.ts.
 *
 * Ofertas vigentes (§8.5): tienda activa, en COP y vistas hace ≤ 72 h. Se leen por
 * `offers.product_id` con el índice cubriente `offers_product_listing_idx` (index-only scan), y
 * la mejor oferta y los agregados de cada tienda salen de una sola ordenación (ventana +
 * `distinct on`). `discountOnly` (§8.4): solo ofertas con descuento validado con historial; esa
 * validación llega en H5, así que de momento ninguna cumple.
 */
export async function findListing(
  sql: Sql,
  source: ListingSource,
  options: { discountOnly: boolean },
): Promise<{ candidates: Candidate[]; groups: MerchantGroup[] }> {
  let cand;
  if (source.kind === 'text') {
    const input = source.input;
    if (!input.normalized) return { candidates: [], groups: [] };
    const brandId = input.brand
      ? sql`(select id from brands where normalized_name = ${input.brand})`
      : sql`null::uuid`;
    cand = sql`
      select p.id, p.brand_id,
             (coalesce(ts_rank_cd(
                case when p.brand_id = q.brand_id
                     then p.search_tsv || to_tsvector('spanish', ${input.brand ?? ''}::text)
                     else p.search_tsv end, q.tsq), 0) * ${input.wText}::float8
              + similarity(public.immutable_unaccent(lower(p.canonical_name)), q.text) * ${input.wTrgm}::float8
              - case when c.accessory and not ${input.accessory}::boolean
                     then ${ACCESSORY_PENALTY}::float8 else 0 end)::float8 as text_score
        from products p
        cross join (select ${input.tsquery ? sql`to_tsquery('spanish', ${input.tsquery})` : sql`null::tsquery`} as tsq,
                           ${input.normalized}::text as text,
                           ${brandId} as brand_id) q
        left join categories c on c.id = p.category_id
       where (q.tsq is not null and p.search_tsv @@ q.tsq)
          or q.text <% public.immutable_unaccent(lower(p.canonical_name))
          or p.brand_id = q.brand_id
       order by text_score desc, p.id
       limit ${MAX_CANDIDATES}`;
  } else if (source.kind === 'category') {
    cand = sql`
      select p.id, p.brand_id, 0::float8 as text_score
        from products p where p.category_id = ${source.categoryId}`;
  } else {
    cand = sql`
      select p.id, p.brand_id, 0::float8 as text_score
        from products p
       where p.id in (select o.product_id from offers o where o.merchant_id = ${source.merchantId})`;
  }
  const merchantId = source.kind === 'merchant' ? source.merchantId : null;

  const rows = await sql<ListingRow[]>`
    with cand as materialized (${cand}),
    live as (
      select o.product_id, o.merchant_id, o.id, o.price, o.list_price,
             o.availability = 'out_of_stock' as oos, o.availability = 'in_stock' as ins, o.last_seen_at
        from cand
        join offers o on o.product_id = cand.id
        join merchants m on m.id = o.merchant_id
       where ${liveOffer(sql)}
         and (${merchantId}::uuid is null or o.merchant_id = ${merchantId}::uuid)
         and not ${options.discountOnly}::boolean
    ),
    grp as (
      select distinct on (product_id, merchant_id)
             product_id, merchant_id, id, price, list_price, oos, last_seen_at,
             max(price) filter (where not oos) over w as max_buyable,
             max(price) over w as max_all,
             count(*) over w as offer_count,
             bool_or(ins) over w as in_stock
        from live
      window w as (partition by product_id, merchant_id)
       order by product_id, merchant_id, oos, price, last_seen_at desc, id
    )
    select cand.id as product_id, cand.text_score, b.normalized_name as brand_key, b.name as brand_name,
           m.slug as merchant, m.name as merchant_name,
           grp.id as best_id, grp.price::float8 as best_price, grp.list_price::float8 as best_list_price,
           grp.oos as best_oos, (extract(epoch from grp.last_seen_at) * 1000)::float8 as best_seen_ms,
           grp.max_buyable::float8 as max_buyable, grp.max_all::float8 as max_all,
           grp.offer_count::int as offer_count, grp.in_stock
      from grp
      join cand on cand.id = grp.product_id
      join merchants m on m.id = grp.merchant_id
      left join brands b on b.id = cand.brand_id`;

  const candidates: Candidate[] = [];
  const groups: MerchantGroup[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!seen.has(r.product_id)) {
      seen.add(r.product_id);
      candidates.push({
        productId: r.product_id,
        textScore: Number(r.text_score),
        brandKey: r.brand_key,
        brandName: r.brand_name,
      });
    }
    groups.push({
      productId: r.product_id,
      merchant: r.merchant,
      merchantName: r.merchant_name,
      best: {
        offerId: r.best_id,
        price: Number(r.best_price),
        listPrice: r.best_list_price === null ? null : Number(r.best_list_price),
        outOfStock: r.best_oos,
        lastSeenMs: Number(r.best_seen_ms),
      },
      maxBuyable: r.max_buyable === null ? null : Number(r.max_buyable),
      maxAll: Number(r.max_all),
      offerCount: r.offer_count,
      inStock: r.in_stock,
    });
  }
  return { candidates, groups };
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

/**
 * Datos para pintar una página de resultados (solo los ~24 productos de la página). Cuenta
 * también las variantes con oferta vigente de cada producto, en las tiendas `merchants` si se
 * indican (filtro de tienda o listado de una tienda).
 */
export async function hydrate(
  sql: Sql,
  productIds: readonly string[],
  offerIds: readonly string[],
  merchants: readonly string[] | null,
): Promise<{
  products: Map<string, ProductDetails>;
  offers: Map<string, OfferDetails>;
  variantCounts: Map<string, number>;
}> {
  if (productIds.length === 0) {
    return { products: new Map(), offers: new Map(), variantCounts: new Map() };
  }
  const [productRows, offerRows, variantRows] = await Promise.all([
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
    sql<{ product_id: string; n: number }[]>`
      select o.product_id, count(distinct o.variant_id)::int as n
        from offers o
        join merchants m on m.id = o.merchant_id
       where o.product_id = any(${productIds as string[]}::uuid[])
         and ${liveOffer(sql)}
         ${merchants?.length ? sql`and m.slug = any(${merchants as string[]}::text[])` : sql``}
       group by o.product_id`,
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
    variantCounts: new Map(variantRows.map((r) => [r.product_id, r.n])),
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

/** Slugs de todas las tiendas (activas o no). */
export async function listMerchantSlugs(sql: Sql): Promise<string[]> {
  const rows = await sql<{ slug: string }[]>`select slug from merchants`;
  return rows.map((r) => r.slug);
}
