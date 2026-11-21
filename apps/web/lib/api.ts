import {
  categoriesResponseSchema,
  categoryListingResponseSchema,
  merchantListingResponseSchema,
  merchantsResponseSchema,
  productResponseSchema,
  searchResponseSchema,
  type CategoriesResponse,
  type CategoryListingResponse,
  type MerchantListingResponse,
  type MerchantsResponse,
  type ProductResponse,
  type SearchResponse,
} from '@encuanto/contracts';
import { apiBaseUrl } from './config';

/** Error de la API ya saneado: la UI solo distingue "no existe" de "no disponible". */
export class ApiError extends Error {
  constructor(readonly kind: 'not_found' | 'unavailable') {
    super(kind === 'not_found' ? 'No encontrado' : 'Servicio no disponible');
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 5000;

/**
 * GET a la API desde el servidor de Next, validando la respuesta con el contrato Zod. Nunca
 * se propaga el cuerpo de error ni la URL (lleva la consulta del usuario) a la página.
 */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function getJson<T>(
  path: string,
  schema: Schema<T>,
  revalidate: number | false = false,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
      ...(revalidate === false ? { cache: 'no-store' as const } : { next: { revalidate } }),
    });
  } catch {
    throw new ApiError('unavailable');
  }
  if (res.status === 404) throw new ApiError('not_found');
  if (!res.ok) throw new ApiError('unavailable');
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError('unavailable');
  return parsed.data;
}

export function searchProducts(query: URLSearchParams): Promise<SearchResponse> {
  return getJson(`/api/search?${query}`, searchResponseSchema);
}

export function getCategoryListing(
  slug: string,
  query: URLSearchParams,
): Promise<CategoryListingResponse> {
  return getJson(
    `/api/categories/${encodeURIComponent(slug)}?${query}`,
    categoryListingResponseSchema,
  );
}

export function getMerchantListing(
  slug: string,
  query: URLSearchParams,
): Promise<MerchantListingResponse> {
  return getJson(
    `/api/merchants/${encodeURIComponent(slug)}?${query}`,
    merchantListingResponseSchema,
  );
}

export function listCategories(): Promise<CategoriesResponse> {
  return getJson('/api/categories', categoriesResponseSchema, 300);
}

export function listMerchants(): Promise<MerchantsResponse> {
  return getJson('/api/merchants', merchantsResponseSchema, 300);
}

export function getProduct(id: string): Promise<ProductResponse> {
  return getJson(`/api/products/${encodeURIComponent(id)}`, productResponseSchema);
}
