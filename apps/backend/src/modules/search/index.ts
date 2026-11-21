/**
 * Módulo `search` (§8.3, §8.6): búsqueda de texto, listados de tienda y categoría, facetas y
 * caché. Dueño de `search_queries`.
 */
export { ListingCache, cacheKey, type CacheStore } from './cache';
export { ACCESSORY_TERMS, parseQuery, type ParsedQuery } from './query';
export { scrubQuery } from './query-log';
export {
  AVAILABILITY_BONUS,
  MIN_SCORE,
  discountPct,
  groupOffers,
  rankListing,
  summarize,
  type Candidate,
  type ListingFilters,
  type LiveOffer,
  type MerchantGroup,
  type RankedItem,
} from './rank';
export { registerSearchRoutes } from './search.routes';
export { SearchService, type SearchDeps, type SearchWeights } from './search.service';
