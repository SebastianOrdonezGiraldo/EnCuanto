import { MAX_FILTER_VALUES, SEARCH_SORTS, type SearchSort } from '@encuanto/contracts';

/** searchParams tal como los entrega Next (un valor, varios o ninguno). */
export type RawParams = Record<string, string | string[] | undefined>;

/** Estado de un listado en la URL (§11: filtros, orden y página compartibles). */
export interface ListingState {
  q: string;
  merchants: string[];
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  sort: SearchSort;
  page: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Acepta `a,b` y también `a&…&b` (lo que envía un formulario con casillas). */
function list(v: string | string[] | undefined, valid: (s: string) => boolean): string[] {
  const values = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(','));
  return [...new Set(values.map((s) => s.trim()).filter((s) => s && valid(s)))].slice(
    0,
    MAX_FILTER_VALUES,
  );
}

/** "1.500.000", "$ 1500000" → 1500000. Cualquier otra cosa se ignora. */
function price(v: string | string[] | undefined): number | undefined {
  const raw = first(v)?.replace(/[$\s.]/g, '');
  if (!raw || !/^\d{1,13}$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * Lee el estado de la URL con tolerancia: un valor inválido se ignora en lugar de romper la
 * página (la API vuelve a validar todo con Zod).
 */
export function parseListingParams(params: RawParams): ListingState {
  const sort = first(params.sort);
  const rawPage = first(params.page);
  const page = rawPage && /^\d{1,15}$/.test(rawPage) ? Number(rawPage) : NaN;
  let minPrice = price(params.min_price);
  let maxPrice = price(params.max_price);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return {
    q: (first(params.q) ?? '').trim().slice(0, 100),
    merchants: list(params.merchants, (s) => SLUG.test(s)),
    brands: list(params.brands, (s) => s.length <= 60),
    minPrice,
    maxPrice,
    sort: (SEARCH_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as SearchSort)
      : 'relevance',
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

/** Query string canónica (listas en CSV, sin valores por defecto). */
export function toQueryString(state: ListingState, overrides: Partial<ListingState> = {}): string {
  const s = { ...state, ...overrides };
  const qs = new URLSearchParams();
  if (s.q) qs.set('q', s.q);
  if (s.merchants.length) qs.set('merchants', s.merchants.join(','));
  if (s.brands.length) qs.set('brands', s.brands.join(','));
  if (s.minPrice !== undefined) qs.set('min_price', String(s.minPrice));
  if (s.maxPrice !== undefined) qs.set('max_price', String(s.maxPrice));
  if (s.sort !== 'relevance') qs.set('sort', s.sort);
  if (s.page > 1) qs.set('page', String(s.page));
  return qs.toString();
}

export function hrefFor(
  path: string,
  state: ListingState,
  overrides: Partial<ListingState> = {},
): string {
  const qs = toQueryString(state, overrides);
  return qs ? `${path}?${qs}` : path;
}

/** Parámetros para la API (sin `q`, que va aparte en la búsqueda). */
export function toApiParams(state: ListingState, pageSize: number): URLSearchParams {
  const qs = new URLSearchParams(toQueryString({ ...state, q: '' }));
  qs.set('page_size', String(pageSize));
  return qs;
}

export const hasFilters = (s: ListingState) =>
  s.merchants.length > 0 ||
  s.brands.length > 0 ||
  s.minPrice !== undefined ||
  s.maxPrice !== undefined;

/**
 * Paginación de un listado: todas las páginas que se derivan del total, sin tope (el conjunto
 * no se recorta). `prev`/`next` son los enlaces a las páginas vecinas, o null.
 */
export function paginate(
  path: string,
  state: ListingState,
  total: number,
  pageSize: number,
): { pages: number; prev: string | null; next: string | null } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return {
    pages,
    prev: state.page > 1 ? hrefFor(path, state, { page: state.page - 1 }) : null,
    next: state.page < pages ? hrefFor(path, state, { page: state.page + 1 }) : null,
  };
}
