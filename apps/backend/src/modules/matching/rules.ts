import type { VariantAttributes } from '@encuanto/db';
import { prepareName, prepareTitle, type PreparedTitle } from './title';
import { similarity } from './trigram';

/**
 * Reglas de matching de §8.2, como función pura: dada una oferta y los candidatos del catálogo,
 * decide. No lee la BD (los candidatos los busca `candidates.repository.ts` o, en los tests, un
 * catálogo en memoria), así que el set de prueba se evalúa igual con y sin PostgreSQL.
 */

/** Umbral de similitud para el enlace automático de nivel 3 (§8.2). */
export const AUTO_SIMILARITY = 0.8;
/** Umbral de similitud para mandar a revisión (nivel 4, §8.2). */
export const REVIEW_SIMILARITY = 0.55;
/**
 * Similitud mínima del nivel 2 (marca + modelo). Ampliación de §8.2: el modelo se extrae del
 * título (§8.1.4) y a veces es un token de especificación que comparten productos distintos de la
 * misma marca; por debajo de este umbral el título no se parece a la ficha y se manda a revisión.
 */
export const MODEL_MIN_SIMILARITY = 0.3;

export const CONFIDENCE = { 1: 1, 2: 0.9, 3: 0.8 } as const;

export interface CandidateVariant {
  id: string;
  gtin: string | null;
  attributes: VariantAttributes;
}

export interface CandidateProduct {
  id: string;
  /** Marca normalizada (`brands.normalized_name`) o null. */
  brand: string | null;
  canonicalName: string;
  modelNumber: string | null;
  /** La categoría de la ficha está marcada como accesorio. */
  accessoryCategory: boolean;
  /** Variantes en orden de creación. */
  variants: CandidateVariant[];
}

export interface MatchCandidates {
  /** Ficha con una variante del mismo GTIN (nivel 1). */
  gtin: { product: CandidateProduct; variant: CandidateVariant } | null;
  /** Fichas de la misma marca y el mismo modelo (nivel 2), en orden de creación. */
  model: CandidateProduct[];
  /** Fichas de nombre parecido y marca compatible (niveles 3 y 4). */
  similar: CandidateProduct[];
}

export interface MatchOffer {
  titleRaw: string;
  gtin: string | null;
  /** Marca normalizada de la oferta (la escribe la ingesta). */
  brand: string | null;
}

export type ReviewReason =
  /** Nivel 4: similitud entre 0,55 y 0,80. */
  | 'similitud_media'
  /** Sin marca en la oferta o en la ficha: el nivel 3 exige la misma marca. */
  | 'sin_marca'
  /** Varias variantes compatibles y ninguna idéntica (p. ej. falta el color en el título). */
  | 'variante_ambigua'
  /** La ficha encaja pero ninguna variante tiene atributos compatibles. */
  | 'variante_nueva'
  /** Mismo modelo pero el título apenas se parece a la ficha. */
  | 'modelo_poco_parecido'
  /** Números que identifican el producto distintos ("Nova 12" frente a "Nova 13"). */
  | 'numeros_distintos'
  /** Uno es un accesorio y el otro no. */
  | 'accesorio'
  /** Uno es un combo o paquete y el otro no. */
  | 'combo'
  /** Mismo GTIN pero marca o atributos incompatibles: el GTIN de la fuente puede estar mal. */
  | 'gtin_conflicto'
  /** Más de una ficha cumple todas las reglas del nivel 3. */
  | 'ficha_ambigua';

export type MatchDecision =
  | { kind: 'auto'; level: 1 | 2 | 3; variantId: string; confidence: number; fillGtin: boolean }
  | { kind: 'new_variant'; level: 2; productId: string; confidence: number }
  | { kind: 'review'; variantId: string; score: number; reason: ReviewReason }
  | { kind: 'new_product'; level: 5 };

/** Atributos compatibles (§8.2): ningún atributo presente en ambos difiere. */
export function compatible(a: VariantAttributes, b: VariantAttributes): boolean {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return Object.keys(ra).every(
    (k) => rb[k] === undefined || ra[k] === undefined || rb[k] === ra[k],
  );
}

function sameAttributes(a: VariantAttributes, b: VariantAttributes): boolean {
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && compatible(a, b) && ka.every((k) => kb.includes(k));
}

/** Atributos en conflicto (para elegir la variante más cercana cuando ninguna es compatible). */
function conflicts(a: VariantAttributes, b: VariantAttributes): number {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return Object.keys(ra).filter(
    (k) => rb[k] !== undefined && ra[k] !== undefined && rb[k] !== ra[k],
  ).length;
}

type VariantChoice =
  | { kind: 'one'; variant: CandidateVariant }
  | { kind: 'ambiguous'; variant: CandidateVariant }
  | { kind: 'none'; nearest: CandidateVariant | null };

/**
 * Variante de la oferta entre las de una o varias fichas: la única con los mismos atributos o,
 * si no la hay, la única compatible. Si hay varias compatibles, es ambigua. Una variante con otro
 * GTIN válido no es compatible: dos GTIN distintos son dos productos distintos.
 */
export function chooseVariant(
  attributes: VariantAttributes,
  variants: readonly CandidateVariant[],
  gtin: string | null = null,
): VariantChoice {
  const compat = variants.filter(
    (v) => compatible(attributes, v.attributes) && (!gtin || !v.gtin || v.gtin === gtin),
  );
  if (compat.length === 0) {
    const nearest = [...variants].sort(
      (x, y) => conflicts(attributes, x.attributes) - conflicts(attributes, y.attributes),
    )[0];
    return { kind: 'none', nearest: nearest ?? null };
  }
  const exact = compat.filter((v) => sameAttributes(attributes, v.attributes));
  if (exact.length === 1) return { kind: 'one', variant: exact[0]! };
  if (compat.length === 1) return { kind: 'one', variant: compat[0]! };
  return { kind: 'ambiguous', variant: exact[0] ?? compat[0]! };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

interface Scored {
  product: CandidateProduct;
  score: number;
}

/** Decide el matching de una oferta (§8.2). */
export function decideMatch(offer: MatchOffer, candidates: MatchCandidates): MatchDecision {
  const title = prepareTitle(offer.titleRaw);
  const score = (p: CandidateProduct) =>
    similarity(title.core, prepareName(p.canonicalName).normalized);
  const brandConflict = (p: CandidateProduct) =>
    !!offer.brand && !!p.brand && offer.brand !== p.brand;
  const kindConflict = (p: CandidateProduct): ReviewReason | null => {
    const name = prepareName(p.canonicalName);
    if (title.accessory !== (name.accessory || p.accessoryCategory)) return 'accesorio';
    if (title.bundle !== name.bundle) return 'combo';
    return null;
  };

  // Nivel 1: GTIN válido igual al de una variante. Se fía del GTIN salvo que la marca o los
  // atributos lo contradigan (GTIN mal puesto por la tienda): entonces revisión.
  if (offer.gtin && candidates.gtin) {
    const { product, variant } = candidates.gtin;
    if (brandConflict(product) || !compatible(title.attributes, variant.attributes)) {
      return {
        kind: 'review',
        variantId: variant.id,
        score: score(product),
        reason: 'gtin_conflicto',
      };
    }
    return {
      kind: 'auto',
      level: 1,
      variantId: variant.id,
      confidence: CONFIDENCE[1],
      fillGtin: false,
    };
  }

  // Nivel 2: misma marca + mismo modelo + atributos compatibles.
  const byModel = candidates.model.filter(
    (p) => offer.brand && p.brand === offer.brand && title.modelKey && sameModel(p, title),
  );
  if (byModel.length > 0) {
    const best = byModel.map((p) => ({ product: p, score: score(p) })).sort(bySimilarity)[0]!;
    const variants = byModel.flatMap((p) => p.variants);
    const choice = chooseVariant(title.attributes, variants, offer.gtin);
    const reviewVariant = choice.kind === 'none' ? choice.nearest : choice.variant;
    const blocked: ReviewReason | null =
      kindConflict(best.product) ??
      (best.score < MODEL_MIN_SIMILARITY ? 'modelo_poco_parecido' : null);
    if (blocked) {
      if (reviewVariant)
        return { kind: 'review', variantId: reviewVariant.id, score: best.score, reason: blocked };
    } else if (choice.kind === 'one') {
      return {
        kind: 'auto',
        level: 2,
        variantId: choice.variant.id,
        confidence: CONFIDENCE[2],
        fillGtin: !!offer.gtin && !choice.variant.gtin,
      };
    } else if (choice.kind === 'none') {
      // Mismo modelo con atributos nuevos (p. ej. 512 GB): variante nueva de la ficha más antigua.
      return {
        kind: 'new_variant',
        level: 2,
        productId: byModel[0]!.id,
        confidence: CONFIDENCE[2],
      };
    } else {
      return {
        kind: 'review',
        variantId: choice.variant.id,
        score: best.score,
        reason: 'variante_ambigua',
      };
    }
  }

  // Niveles 3 y 4: similitud de trigramas del núcleo del título con el nombre de la ficha.
  const similar = candidates.similar
    .filter((p) => !brandConflict(p) && !modelConflict(title.modelKey, modelKeyOf(p)))
    .map((p) => ({ product: p, score: score(p) }))
    .filter((s) => s.score >= REVIEW_SIMILARITY)
    .sort(bySimilarity);
  const autos: { product: CandidateProduct; variant: CandidateVariant; score: number }[] = [];
  let review: { variantId: string; score: number; reason: ReviewReason } | null = null;
  for (const { product, score: s } of similar) {
    const name = prepareName(product.canonicalName);
    const choice = chooseVariant(title.attributes, product.variants, offer.gtin);
    const blocked: ReviewReason | null =
      s < AUTO_SIMILARITY
        ? 'similitud_media'
        : !offer.brand || !product.brand
          ? 'sin_marca'
          : (kindConflict(product) ??
            (!sameSet(title.identity, name.identity)
              ? 'numeros_distintos'
              : choice.kind === 'none'
                ? 'variante_nueva'
                : choice.kind === 'ambiguous'
                  ? 'variante_ambigua'
                  : null));
    if (!blocked && choice.kind === 'one') {
      autos.push({ product, variant: choice.variant, score: s });
      continue;
    }
    const variant = choice.kind === 'none' ? choice.nearest : choice.variant;
    if (!review && variant)
      review = { variantId: variant.id, score: s, reason: blocked ?? 'similitud_media' };
  }
  if (autos.length === 1) {
    const a = autos[0]!;
    return {
      kind: 'auto',
      level: 3,
      variantId: a.variant.id,
      confidence: CONFIDENCE[3],
      fillGtin: false,
    };
  }
  if (autos.length > 1) {
    return {
      kind: 'review',
      variantId: autos[0]!.variant.id,
      score: autos[0]!.score,
      reason: 'ficha_ambigua',
    };
  }
  if (review) return { kind: 'review', ...review };

  // Nivel 5: sin candidato, ficha nueva.
  return { kind: 'new_product', level: 5 };
}

/** Más parecida primero; a igual similitud, por nombre, modelo y id (determinista). */
function bySimilarity(a: Scored, b: Scored): number {
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return (
    b.score - a.score ||
    cmp(a.product.canonicalName, b.product.canonicalName) ||
    cmp(a.product.modelNumber ?? '', b.product.modelNumber ?? '') ||
    cmp(a.product.id, b.product.id)
  );
}

/**
 * Dos modelos distintos son dos productos distintos: esa ficha no es candidata, ni siquiera para
 * revisión. Si no, cada modelo nuevo de una línea con nombre parecido ("Lavadora X Aqua NU-9565"
 * frente a "Lavadora X Clean NU-9565S") llenaría la cola y, mientras espera, no tendría ficha
 * propia. Con un sufijo regional (`SM-A566B` / `SM-A566E`) la ficha sale duplicada; se puede
 * unir después desde la revisión.
 */
export function modelConflict(a: string | null, b: string | null): boolean {
  return !!a && !!b && a !== b;
}

function modelKeyOf(p: CandidateProduct): string | null {
  const key = p.modelNumber ? p.modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  return key || null;
}

function sameModel(p: CandidateProduct, title: PreparedTitle): boolean {
  return modelKeyOf(p) === title.modelKey;
}
