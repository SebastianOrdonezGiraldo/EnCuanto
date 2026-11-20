import type { SearchSort } from '@encuanto/contracts';

/**
 * Ranking, filtros y facetas de un listado (§8.3), como funciones puras sobre lo que devuelve
 * la BD: los productos candidatos con su puntuación de texto y sus ofertas vigentes.
 */

/** Bonificación por tener al menos una oferta en stock (§8.3). */
export const AVAILABILITY_BONUS = 0.1;
/** Umbral mínimo de puntuación (§8.3): por debajo, el producto no es un resultado. */
export const MIN_SCORE = 0.05;
/** Tamaño máximo del conjunto ordenado que se cachea (§8.6). */
export const MAX_RESULTS = 1000;

export interface Candidate {
  productId: string;
  /** `ts_rank_cd·w_text + similarity·w_trgm − penalización de accesorio`. 0 en los listados. */
  textScore: number;
  brandKey: string | null;
  brandName: string | null;
}

/** Oferta vigente (`last_seen_at` ≤ 72 h, tienda activa) de un producto candidato. */
export interface LiveOffer {
  productId: string;
  offerId: string;
  variantId: string;
  merchant: string;
  merchantName: string;
  price: number;
  listPrice: number | null;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  lastSeenAt: Date;
}

export interface ListingFilters {
  merchants?: readonly string[];
  /** Marcas por su nombre normalizado (`brands.normalized_name`). */
  brands?: readonly string[];
  minPrice?: number;
  maxPrice?: number;
  discountOnly: boolean;
}

/** Un producto del conjunto ordenado. Es lo que se guarda en la caché (§8.6). */
export interface RankedItem {
  productId: string;
  score: number;
  bestOfferId: string;
  minPrice: number;
  maxPrice: number;
  offerCount: number;
  variantCount: number;
  merchantCount: number;
}

export interface FacetCounts {
  merchants: { slug: string; name: string; count: number }[];
  brands: { name: string; count: number }[];
  price: { min: number; max: number } | null;
}

export interface RankOptions {
  /** `text`: búsqueda con umbral de §8.3. `browse`: listado de tienda o categoría, sin texto. */
  mode: 'text' | 'browse';
  sort: SearchSort;
}

/** `round((list − price) / list × 100, 1)` (§8.4). `null` sin precio de lista. */
export function discountPct(price: number, listPrice: number | null): number | null {
  if (!listPrice || listPrice <= price) return null;
  return Math.round(((listPrice - price) / listPrice) * 1000) / 10;
}

/**
 * Descuento validado con historial (§8.4). La validación (mediana de 30 días, tope del 80 %…)
 * llega en H5 con el módulo `pricing`; hasta entonces ningún descuento cuenta como validado, así
 * que `discount_only` devuelve vacío en lugar de dar por buenos los descuentos de la tienda.
 */
export function isDiscountValidated(_offer: LiveOffer): boolean {
  return false;
}

interface Summary {
  best: LiveOffer;
  minPrice: number;
  maxPrice: number;
  offerCount: number;
  variantCount: number;
  merchantCount: number;
  inStock: boolean;
}

const outOfStock = (o: LiveOffer) => o.availability === 'out_of_stock';

/** Mejor oferta: primero las que se pueden comprar, luego la más barata y la vista más reciente. */
function compareOffers(a: LiveOffer, b: LiveOffer): number {
  return (
    Number(outOfStock(a)) - Number(outOfStock(b)) ||
    a.price - b.price ||
    b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
    (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0)
  );
}

/**
 * Resume las ofertas de un producto. El rango de precio usa solo las ofertas que se pueden
 * comprar si hay alguna: un agotado más barato no es el "desde $X".
 */
export function summarize(offers: readonly LiveOffer[]): Summary | null {
  if (offers.length === 0) return null;
  const best = [...offers].sort(compareOffers)[0]!;
  const buyable = offers.filter((o) => !outOfStock(o));
  const priced = buyable.length > 0 ? buyable : offers;
  return {
    best,
    minPrice: best.price,
    maxPrice: Math.max(...priced.map((o) => o.price)),
    offerCount: offers.length,
    variantCount: new Set(offers.map((o) => o.variantId)).size,
    merchantCount: new Set(offers.map((o) => o.merchant)).size,
    inStock: offers.some((o) => o.availability === 'in_stock'),
  };
}

const inRange = (price: number, f: ListingFilters) =>
  (f.minPrice === undefined || price >= f.minPrice) &&
  (f.maxPrice === undefined || price <= f.maxPrice);

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Aplica filtros, umbral y orden, y calcula las facetas.
 *
 * Facetas disyuntivas: cada una ignora su propio filtro y respeta los demás, así que el número
 * de una tienda es cuántos productos quedarían al marcarla (con su propio precio dentro del
 * rango), el de una marca cuántos quedarían con esa marca, y el rango de precio el de los
 * productos que cumplen el resto de filtros.
 */
export function rankListing(
  candidates: readonly Candidate[],
  offers: readonly LiveOffer[],
  filters: ListingFilters,
  options: RankOptions,
): { items: RankedItem[]; facets: FacetCounts } {
  const byProduct = new Map<string, LiveOffer[]>();
  for (const o of offers) {
    if (filters.discountOnly && !isDiscountValidated(o)) continue;
    const list = byProduct.get(o.productId);
    if (list) list.push(o);
    else byProduct.set(o.productId, [o]);
  }
  const merchantSet = filters.merchants?.length ? new Set(filters.merchants) : null;
  const brandSet = filters.brands?.length ? new Set(filters.brands) : null;

  const items: (RankedItem & { discount: number | null })[] = [];
  const merchantFacet = new Map<string, { name: string; count: number }>();
  const brandFacet = new Map<string, { name: string; count: number }>();
  let priceMin = Infinity;
  let priceMax = -Infinity;

  for (const c of candidates) {
    const all = byProduct.get(c.productId);
    if (!all) continue;
    const brandOk = !brandSet || (c.brandKey !== null && brandSet.has(c.brandKey));

    // Faceta de tiendas: ignora el filtro de tienda, respeta marca y precio.
    if (brandOk) {
      const perMerchant = new Map<string, LiveOffer[]>();
      for (const o of all) {
        const list = perMerchant.get(o.merchant);
        if (list) list.push(o);
        else perMerchant.set(o.merchant, [o]);
      }
      for (const [slug, list] of perMerchant) {
        const s = summarize(list)!;
        if (
          options.mode === 'text' &&
          c.textScore + (s.inStock ? AVAILABILITY_BONUS : 0) <= MIN_SCORE
        )
          continue;
        if (!inRange(s.minPrice, filters)) continue;
        const entry = merchantFacet.get(slug) ?? { name: s.best.merchantName, count: 0 };
        entry.count++;
        merchantFacet.set(slug, entry);
      }
    }

    const filtered = merchantSet ? all.filter((o) => merchantSet.has(o.merchant)) : all;
    const s = summarize(filtered);
    if (!s) continue;
    const score = c.textScore + (s.inStock ? AVAILABILITY_BONUS : 0);
    if (options.mode === 'text' && score <= MIN_SCORE) continue;
    const priceOk = inRange(s.minPrice, filters);

    // Faceta de marcas: ignora el filtro de marca.
    if (priceOk && c.brandKey && c.brandName) {
      const entry = brandFacet.get(c.brandKey) ?? { name: c.brandName, count: 0 };
      entry.count++;
      brandFacet.set(c.brandKey, entry);
    }
    // Rango de precio: ignora el filtro de precio.
    if (brandOk) {
      priceMin = Math.min(priceMin, s.minPrice);
      priceMax = Math.max(priceMax, s.minPrice);
    }
    if (!brandOk || !priceOk) continue;

    items.push({
      productId: c.productId,
      score: round4(score),
      bestOfferId: s.best.offerId,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      offerCount: s.offerCount,
      variantCount: s.variantCount,
      merchantCount: s.merchantCount,
      discount: discountPct(s.best.price, s.best.listPrice),
    });
  }

  items.sort(comparator(options));
  const byCountThenName = <T extends { name: string; count: number }>(a: T, b: T) =>
    b.count - a.count || a.name.localeCompare(b.name, 'es');

  return {
    items: items.slice(0, MAX_RESULTS).map(({ discount: _discount, ...item }) => item),
    facets: {
      merchants: [...merchantFacet]
        .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
        .sort(byCountThenName),
      brands: [...brandFacet.values()].sort(byCountThenName),
      price: priceMin === Infinity ? null : { min: priceMin, max: priceMax },
    },
  };
}

type Sortable = RankedItem & { discount: number | null };

const byId = (a: Sortable, b: Sortable) =>
  a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;

/**
 * Órdenes de §7. En relevancia los empates se resuelven por precio mínimo (§8.3); en los
 * listados sin texto, "relevancia" es: en stock, en más tiendas y más barato. El id al final
 * hace el orden estable entre ejecuciones (la página se recorta del conjunto cacheado).
 */
function comparator(options: RankOptions): (a: Sortable, b: Sortable) => number {
  const relevance = (a: Sortable, b: Sortable) =>
    options.mode === 'text'
      ? b.score - a.score || a.minPrice - b.minPrice
      : b.score - a.score || b.merchantCount - a.merchantCount || a.minPrice - b.minPrice;
  switch (options.sort) {
    case 'price_asc':
      return (a, b) => a.minPrice - b.minPrice || relevance(a, b) || byId(a, b);
    case 'price_desc':
      return (a, b) => b.minPrice - a.minPrice || relevance(a, b) || byId(a, b);
    case 'discount':
      return (a, b) => (b.discount ?? -1) - (a.discount ?? -1) || relevance(a, b) || byId(a, b);
    default:
      return (a, b) => relevance(a, b) || byId(a, b);
  }
}
