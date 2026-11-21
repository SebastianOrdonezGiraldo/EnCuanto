import type {
  CandidateProduct,
  MatchCandidates,
  MatchDecision,
} from '../../src/modules/matching/index';
import type { DatasetOffer, DatasetProduct } from './set-de-prueba';

/** Catálogo del set de prueba como candidatos (ids = claves del set). */
export function toCandidates(catalog: readonly DatasetProduct[]): CandidateProduct[] {
  return catalog.map((p) => ({
    id: p.key,
    brand: p.brand,
    canonicalName: p.name,
    modelNumber: p.model,
    accessoryCategory: !!p.accessoryCategory,
    variants: p.variants.map((v) => ({ id: v.key, gtin: v.gtin, attributes: v.attributes })),
  }));
}

export interface CaseResult {
  offer: DatasetOffer;
  decision: MatchDecision;
  /** La decisión enlazó la oferta sin intervención (auto o variante nueva). */
  automatic: boolean;
  /** Si fue automática, si acertó. */
  correct: boolean;
}

/**
 * Compara una decisión con la respuesta correcta. `variantOf` traduce el id de variante de la
 * decisión a la clave del set (en memoria ya es la clave; en la BD, un uuid) y `productOf` el id
 * de producto.
 */
export function judge(
  offer: DatasetOffer,
  decision: MatchDecision,
  variantKey: (id: string) => string = (id) => id,
  productKey: (id: string) => string = (id) => id,
): CaseResult {
  const e = offer.expected;
  if (decision.kind === 'auto') {
    const key = variantKey(decision.variantId);
    return { offer, decision, automatic: true, correct: 'variant' in e && e.variant === key };
  }
  if (decision.kind === 'new_variant') {
    const key = productKey(decision.productId);
    return {
      offer,
      decision,
      automatic: true,
      correct: 'newVariantOf' in e && e.newVariantOf === key,
    };
  }
  return { offer, decision, automatic: false, correct: false };
}

export interface Metrics {
  cases: number;
  automatic: number;
  correct: number;
  /** Aciertos / enlaces automáticos. */
  precision: number;
  /** Ofertas con respuesta en el catálogo (variante o variante nueva) enlazadas bien solas. */
  coverage: number;
  reviews: number;
  newProducts: number;
}

export function metrics(results: readonly CaseResult[]): Metrics {
  const automatic = results.filter((r) => r.automatic);
  const correct = automatic.filter((r) => r.correct).length;
  const answerable = results.filter(
    (r) => 'variant' in r.offer.expected || 'newVariantOf' in r.offer.expected,
  );
  return {
    cases: results.length,
    automatic: automatic.length,
    correct,
    precision: automatic.length === 0 ? 1 : correct / automatic.length,
    coverage:
      answerable.length === 0 ? 1 : answerable.filter((r) => r.correct).length / answerable.length,
    reviews: results.filter((r) => r.decision.kind === 'review').length,
    newProducts: results.filter((r) => r.decision.kind === 'new_product').length,
  };
}

/** Tabla legible de los casos (para el log del test y la entrega). */
export function describe(results: readonly CaseResult[]): string {
  return results
    .map((r) => {
      const d = r.decision;
      const what =
        d.kind === 'auto'
          ? `auto N${d.level} → ${d.variantId}`
          : d.kind === 'new_variant'
            ? `variante nueva de ${d.productId}`
            : d.kind === 'review'
              ? `revisión (${d.reason}, ${d.score.toFixed(2)})`
              : 'ficha nueva';
      const mark = r.automatic ? (r.correct ? 'OK ' : 'ERR') : '-  ';
      return `${mark} ${r.offer.title}  ⇒  ${what}`;
    })
    .join('\n');
}

export type { MatchCandidates };
