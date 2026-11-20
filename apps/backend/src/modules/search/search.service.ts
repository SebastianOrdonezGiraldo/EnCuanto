import {
  freshnessOf,
  type CategoriesResponse,
  type CategoryListingResponse,
  type ListingQuery,
  type MerchantListingResponse,
  type MerchantsResponse,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
} from '@encuanto/contracts';
import type { DbClient } from '@encuanto/db';
import { performance } from 'node:perf_hooks';
import { NotFoundError } from '../../shared/errors';
import type { Log } from '../../shared/log';
import { loadBrandNames } from '../catalog/index';
import { brandKey, buildBrandDictionary, type BrandDictionary } from '../normalization/index';
import { cacheKey, type CachedListing, type ListingCache } from './cache';
import { parseQuery } from './query';
import { logSearchQuery } from './query-log';
import { discountPct, rankListing, type ListingFilters, type RankOptions } from './rank';
import {
  findListing,
  type ListingSource,
  getActiveMerchantBySlug,
  getCategoryBySlug,
  hydrate,
  listActiveMerchants,
  listCategoriesWithProducts,
  listMerchantSlugs,
} from './search.repository';

export interface SearchWeights {
  /** `w_text` de §8.3 (por defecto 1). */
  text: number;
  /** `w_trgm` de §8.3 (por defecto 0,5). */
  trgm: number;
}

export interface SearchDeps {
  client: DbClient;
  cache: ListingCache;
  log: Log;
  weights: SearchWeights;
  /** Registrar cada búsqueda en `search_queries` (por defecto sí). */
  logQueries?: boolean;
  now?: () => Date;
}

/** El diccionario de marcas cambia poco: se recarga como mucho cada 5 minutos. */
const BRANDS_TTL_MS = 5 * 60_000;

type ListingPage = Pick<
  SearchResponse,
  'total' | 'page' | 'page_size' | 'results' | 'facets' | 'cache'
>;

export class SearchService {
  private dictionaries: {
    brands: BrandDictionary;
    merchants: ReadonlySet<string>;
    loadedAt: number;
  } | null = null;

  constructor(private readonly deps: SearchDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Marcas y tiendas conocidas: para interpretar la consulta y para no registrar texto libre. */
  private async catalogTerms(): Promise<{
    brands: BrandDictionary;
    merchants: ReadonlySet<string>;
  }> {
    if (!this.dictionaries || Date.now() - this.dictionaries.loadedAt > BRANDS_TTL_MS) {
      const [brandNames, merchantSlugs] = await Promise.all([
        loadBrandNames(this.deps.client.db),
        listMerchantSlugs(this.deps.client.sql),
      ]);
      this.dictionaries = {
        brands: buildBrandDictionary(brandNames),
        merchants: new Set(merchantSlugs),
        loadedAt: Date.now(),
      };
    }
    return this.dictionaries;
  }

  /** GET /api/search (§7, §8.3, §8.6). */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const started = performance.now();
    const terms = await this.catalogTerms();
    const parsed = parseQuery(query.q, terms.brands);
    const filters = toFilters(query);
    const { weights } = this.deps;
    const { listing, hit } = await this.cached(
      'search',
      // Los pesos entran en la identidad: cambiarlos no debe servir órdenes calculados con otros.
      {
        q: parsed.normalized,
        b: parsed.brand,
        w: [weights.text, weights.trgm],
        f: filters,
        s: query.sort,
      },
      async () => {
        const source = {
          kind: 'text' as const,
          input: {
            tsquery: parsed.tsquery,
            normalized: parsed.normalized,
            brand: parsed.brand,
            accessory: parsed.accessory,
            wText: weights.text,
            wTrgm: weights.trgm,
          },
        };
        return this.rank(source, filters, { mode: 'text', sort: query.sort });
      },
    );
    const page = await this.page(listing, hit, query, filters.merchants ?? null);

    if (this.deps.logQueries !== false) {
      logSearchQuery(this.deps.client.db, this.deps.log, {
        query: query.q,
        filters: filtersForLog(query, terms),
        resultsCount: page.total,
        latencyMs: performance.now() - started,
      });
    }

    return {
      query: query.q,
      normalized: {
        terms: parsed.terms,
        brand: parsed.brand,
        attributes: { ...parsed.attributes },
      },
      ...page,
    };
  }

  /** GET /api/categories/:slug: productos de la categoría con filtros y orden. */
  async browseCategory(slug: string, query: ListingQuery): Promise<CategoryListingResponse> {
    const category = await getCategoryBySlug(this.deps.client.sql, slug);
    if (!category) throw new NotFoundError('Categoría no encontrada');
    const filters = toFilters(query);
    const { listing, hit } = await this.cached(
      'browse',
      { k: 'category', id: category.id, f: filters, s: query.sort },
      async () =>
        this.rank({ kind: 'category', categoryId: category.id }, filters, {
          mode: 'browse',
          sort: query.sort,
        }),
    );
    return {
      category: { slug: category.slug, name: category.name },
      ...(await this.page(listing, hit, query, filters.merchants ?? null)),
    };
  }

  /** GET /api/merchants/:slug: productos con oferta vigente de la tienda, con su precio en ella. */
  async browseMerchant(slug: string, query: ListingQuery): Promise<MerchantListingResponse> {
    const merchant = await getActiveMerchantBySlug(this.deps.client.sql, slug);
    if (!merchant) throw new NotFoundError('Tienda no encontrada');
    // La tienda es fija: el filtro `merchants` no aplica en su propio listado.
    const filters = toFilters({ ...query, merchants: undefined });
    const { listing, hit } = await this.cached(
      'browse',
      { k: 'merchant', id: merchant.id, f: filters, s: query.sort },
      async () =>
        this.rank({ kind: 'merchant', merchantId: merchant.id }, filters, {
          mode: 'browse',
          sort: query.sort,
        }),
    );
    return {
      merchant: { slug: merchant.slug, name: merchant.name },
      ...(await this.page(listing, hit, query, [merchant.slug])),
    };
  }

  async categories(): Promise<CategoriesResponse> {
    return { categories: await listCategoriesWithProducts(this.deps.client.sql) };
  }

  async merchants(): Promise<MerchantsResponse> {
    return { merchants: await listActiveMerchants(this.deps.client.sql) };
  }

  private async rank(
    source: ListingSource,
    filters: ListingFilters,
    options: RankOptions,
  ): Promise<CachedListing> {
    const { candidates, groups } = await findListing(this.deps.client.sql, source, {
      discountOnly: filters.discountOnly,
    });
    const { items, facets } = rankListing(candidates, groups, filters, options);
    return { generatedAt: this.now().toISOString(), items, facets };
  }

  /** Lee el conjunto de la caché (§8.6) o lo calcula y lo guarda. Sin Redis, siempre calcula. */
  private async cached(
    prefix: 'search' | 'browse',
    identity: unknown,
    compute: () => Promise<CachedListing>,
  ): Promise<{ listing: CachedListing; hit: boolean }> {
    const version = await this.deps.cache.version();
    const key = version === null ? null : cacheKey(prefix, version, identity);
    if (key) {
      const hit = await this.deps.cache.get(key);
      if (hit) return { listing: hit, hit: true };
    }
    const listing = await compute();
    if (key) await this.deps.cache.set(key, listing);
    return { listing, hit: false };
  }

  /**
   * Recorta la página del conjunto ordenado y la completa con los datos vigentes. `merchants`:
   * tiendas a las que se limita el listado (filtro o listado de una tienda), para contar variantes.
   */
  private async page(
    listing: CachedListing,
    hit: boolean,
    query: ListingQuery,
    merchants: readonly string[] | null,
  ): Promise<ListingPage> {
    const start = (query.page - 1) * query.page_size;
    const slice = listing.items.slice(start, start + query.page_size);
    const { products, offers, variantCounts } = await hydrate(
      this.deps.client.sql,
      slice.map((i) => i.productId),
      slice.map((i) => i.bestOfferId),
      merchants,
    );
    const now = this.now();
    const results: SearchResult[] = [];
    for (const item of slice) {
      const product = products.get(item.productId);
      const offer = offers.get(item.bestOfferId);
      if (!product || !offer) continue;
      const freshness = freshnessOf(offer.lastSeenAt, now);
      if (freshness === 'hidden') continue;
      results.push({
        product_id: product.id,
        name: product.name,
        brand: product.brand,
        category:
          product.categorySlug && product.categoryName
            ? { slug: product.categorySlug, name: product.categoryName }
            : null,
        image_url: product.imageUrl ?? offer.imageUrl,
        variant_count: variantCounts.get(item.productId) ?? 1,
        offer_count: item.offerCount,
        merchant_count: item.merchantCount,
        min_price: item.minPrice,
        max_price: item.maxPrice,
        best_offer: {
          offer_id: offer.id,
          merchant: offer.merchant,
          merchant_name: offer.merchantName,
          price: offer.price,
          list_price: offer.listPrice,
          discount_pct: discountPct(offer.price, offer.listPrice),
          discount_validated: false,
          in_stock: offer.availability === 'in_stock',
          last_seen_at: offer.lastSeenAt.toISOString(),
          stale: freshness === 'stale',
        },
      });
    }
    return {
      total: listing.items.length,
      page: query.page,
      page_size: query.page_size,
      results,
      facets: listing.facets,
      cache: { hit, generated_at: listing.generatedAt },
    };
  }
}

/** Filtros canónicos (ordenados), para que la misma búsqueda dé la misma clave de caché. */
function toFilters(query: ListingQuery): ListingFilters {
  const sorted = (list?: string[]) => (list?.length ? [...new Set(list)].sort() : undefined);
  return {
    merchants: sorted(query.merchants),
    brands: sorted(query.brands?.map(brandKey).filter(Boolean)),
    minPrice: query.min_price,
    maxPrice: query.max_price,
    discountOnly: query.discount_only,
  };
}

/**
 * Filtros que se guardan en `search_queries`: solo valores del catálogo. Las tiendas y marcas
 * que no existen se descartan, porque son texto libre del usuario (podrían ser un correo).
 */
export function filtersForLog(
  query: SearchQuery,
  known: { brands: BrandDictionary; merchants: ReadonlySet<string> },
): Record<string, unknown> {
  const out: Record<string, unknown> = { sort: query.sort, page: query.page };
  const merchants = query.merchants?.filter((m) => known.merchants.has(m));
  if (merchants?.length) out.merchants = merchants;
  const brands = query.brands
    ?.map((b) => known.brands.get(brandKey(b)))
    .filter((b): b is string => !!b);
  if (brands?.length) out.brands = [...new Set(brands)];
  if (query.min_price !== undefined) out.min_price = query.min_price;
  if (query.max_price !== undefined) out.max_price = query.max_price;
  if (query.discount_only) out.discount_only = true;
  return out;
}
