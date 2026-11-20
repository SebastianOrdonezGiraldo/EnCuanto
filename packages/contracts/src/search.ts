import { z } from 'zod';
import { merchantSlugSchema } from './admin';

/** Precio máximo admitido en filtros: 10^12 pesos (muy por encima de cualquier producto). */
export const MAX_FILTER_PRICE = 1_000_000_000_000;
export const MAX_PAGE_SIZE = 48;
export const DEFAULT_PAGE_SIZE = 24;
/** Páginas navegables: el conjunto cacheado tiene como mucho 1.000 productos (§8.6). */
export const MAX_PAGE = 100;
/** Máximo de valores en un filtro CSV (`merchants`, `brands`). */
export const MAX_FILTER_VALUES = 20;

export const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'discount'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Lista separada por comas: "a,b" → ["a","b"], sin vacíos ni repetidos. */
function csv<T extends z.ZodType<string, string>>(item: T) {
  return z
    .string()
    .max(2000)
    .transform((s) => [
      ...new Set(
        s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(item).max(MAX_FILTER_VALUES));
}

const price = z.coerce.number().int().min(0).max(MAX_FILTER_PRICE);
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Filtros, orden y paginación comunes a la búsqueda y a los listados de tienda y categoría. */
const listingFieldsSchema = z.object({
  merchants: csv(merchantSlugSchema).optional(),
  brands: csv(z.string().min(1).max(60)).optional(),
  min_price: price.optional(),
  max_price: price.optional(),
  discount_only: bool.default(false),
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  page_size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const priceRange = {
  check: (v: { min_price?: number; max_price?: number }) =>
    v.min_price === undefined || v.max_price === undefined || v.min_price <= v.max_price,
  params: { message: 'min_price no puede ser mayor que max_price', path: ['min_price'] },
};

export const listingQuerySchema = listingFieldsSchema.refine(priceRange.check, priceRange.params);

/** GET /api/search (§7): `q` de 2 a 100 caracteres (sin contar espacios de los extremos). */
export const searchQuerySchema = listingFieldsSchema
  .extend({ q: z.string().trim().min(2).max(100) })
  .refine(priceRange.check, priceRange.params);

export type ListingQuery = z.infer<typeof listingQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Frescura de un precio (§8.5). */
export const FRESHNESS_STALE_HOURS = 24;
export const FRESHNESS_HIDDEN_HOURS = 72;

/**
 * Estado de frescura según `last_seen_at`: `fresh` (< 24 h), `stale` (24–72 h, "puede haber
 * cambiado") o `hidden` (> 72 h: la oferta no se muestra).
 */
export function freshnessOf(
  lastSeenAt: Date | string,
  now: Date = new Date(),
): 'fresh' | 'stale' | 'hidden' {
  const hours = (now.getTime() - new Date(lastSeenAt).getTime()) / 3_600_000;
  if (hours > FRESHNESS_HIDDEN_HOURS) return 'hidden';
  if (hours >= FRESHNESS_STALE_HOURS) return 'stale';
  return 'fresh';
}

const isoDate = z.iso.datetime({ offset: true });

export const bestOfferSchema = z.object({
  offer_id: z.uuid(),
  merchant: z.string(),
  merchant_name: z.string(),
  price: z.number().int(),
  list_price: z.number().int().nullable(),
  discount_pct: z.number().nullable(),
  /** Descuento validado con historial (§8.4, H5). Mientras tanto siempre `false`. */
  discount_validated: z.boolean(),
  in_stock: z.boolean(),
  last_seen_at: isoDate,
  /** Visto hace entre 24 y 72 h: "puede haber cambiado" (§8.5). */
  stale: z.boolean(),
});

export const searchResultSchema = z.object({
  product_id: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.object({ slug: z.string(), name: z.string() }).nullable(),
  image_url: z.string().nullable(),
  variant_count: z.number().int(),
  offer_count: z.number().int(),
  merchant_count: z.number().int(),
  min_price: z.number().int(),
  max_price: z.number().int(),
  best_offer: bestOfferSchema,
});

export const facetsSchema = z.object({
  merchants: z.array(z.object({ slug: z.string(), name: z.string(), count: z.number().int() })),
  brands: z.array(z.object({ name: z.string(), count: z.number().int() })),
  price: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
});

const listingFields = {
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  results: z.array(searchResultSchema),
  facets: facetsSchema,
  cache: z.object({ hit: z.boolean(), generated_at: isoDate }),
};

/** Respuesta de GET /api/search (§7). */
export const searchResponseSchema = z.object({
  query: z.string(),
  normalized: z.object({
    terms: z.array(z.string()),
    brand: z.string().nullable(),
    attributes: z.record(z.string(), z.union([z.string(), z.number()])),
  }),
  ...listingFields,
});

/** GET /api/categories/:slug */
export const categoryListingResponseSchema = z.object({
  category: z.object({ slug: z.string(), name: z.string() }),
  ...listingFields,
});

/** GET /api/merchants/:slug */
export const merchantListingResponseSchema = z.object({
  merchant: z.object({ slug: z.string(), name: z.string() }),
  ...listingFields,
});

/** GET /api/categories: categorías con productos con ofertas vigentes (también para el sitemap). */
export const categoriesResponseSchema = z.object({
  categories: z.array(
    z.object({ slug: z.string(), name: z.string(), product_count: z.number().int() }),
  ),
});

/** GET /api/merchants: tiendas activas con ofertas vigentes. */
export const merchantsResponseSchema = z.object({
  merchants: z.array(
    z.object({ slug: z.string(), name: z.string(), offer_count: z.number().int() }),
  ),
});

export type BestOffer = z.infer<typeof bestOfferSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type Facets = z.infer<typeof facetsSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type CategoryListingResponse = z.infer<typeof categoryListingResponseSchema>;
export type MerchantListingResponse = z.infer<typeof merchantListingResponseSchema>;
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;
export type MerchantsResponse = z.infer<typeof merchantsResponseSchema>;
