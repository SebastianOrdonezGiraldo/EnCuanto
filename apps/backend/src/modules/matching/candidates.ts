import { prepareName, prepareTitle } from './title';
import { similarity } from './trigram';
import type { CandidateProduct, MatchCandidates, MatchOffer } from './rules';

/**
 * Similitud mínima con la que la BD devuelve fichas parecidas (`pg_trgm.similarity_threshold`).
 * Está por debajo de `REVIEW_SIMILARITY` (0,55) para que ninguna ficha que la decisión aceptaría
 * se quede fuera; la decisión vuelve a calcular la similitud en TypeScript.
 */
export const RECALL_SIMILARITY = 0.5;
/**
 * Tope de fichas parecidas por oferta, las de mayor similitud. Solo evita leer cientos de fichas
 * cuando muchas comparten palabras ("Funda para celular…"): la decisión usa la mejor que cumpla
 * las reglas, y con 50 fichas por encima de 0,5 la oferta acabaría en revisión de todos modos.
 * Si se alcanza, el resultado de `runMatching` lo cuenta en `candidatesCapped` y se registra.
 */
export const MAX_SIMILAR_PRODUCTS = 50;

/**
 * Candidatos de una oferta sobre un catálogo en memoria, con las mismas reglas que la consulta
 * SQL (`candidates.repository.ts`). Lo usan los tests del set de prueba sin PostgreSQL; un test
 * de integración comprueba que ambos devuelven las mismas decisiones.
 */
export function candidatesInMemory(
  catalog: readonly CandidateProduct[],
  offer: MatchOffer,
): MatchCandidates & { capped: boolean } {
  const title = prepareTitle(offer.titleRaw);
  let gtin: MatchCandidates['gtin'] = null;
  if (offer.gtin) {
    for (const product of catalog) {
      const variant = product.variants.find((v) => v.gtin === offer.gtin);
      if (variant && !gtin) gtin = { product, variant };
    }
  }
  const modelKeyOf = (p: CandidateProduct) =>
    p.modelNumber ? p.modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null;
  const model =
    offer.brand && title.modelKey
      ? catalog.filter((p) => p.brand === offer.brand && modelKeyOf(p) === title.modelKey)
      : [];
  const scored = catalog
    .filter((p) => !offer.brand || !p.brand || p.brand === offer.brand)
    .map((p) => ({ p, s: similarity(prepareName(p.canonicalName).normalized, title.core) }))
    .filter((x) => x.s >= RECALL_SIMILARITY)
    .sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
  return {
    gtin,
    model,
    similar: scored.slice(0, MAX_SIMILAR_PRODUCTS).map((x) => x.p),
    capped: scored.length > MAX_SIMILAR_PRODUCTS,
  };
}
