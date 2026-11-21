import type { VariantAttributes } from '@encuanto/db';
import {
  ACCESSORY_TERMS,
  extractAttributes,
  normalizeBrand,
  normalizeText,
  type BrandDictionary,
} from '../normalization/index';

/** Términos de accesorio (§8.3); viven en `normalization`, que los comparte con el matching. */
export { ACCESSORY_TERMS };

/** Máximo de términos que entran en la consulta de texto. */
export const MAX_TERMS = 12;

export interface ParsedQuery {
  /** Consulta normalizada (§8.1.1) y reducida a letras, números y espacios. */
  normalized: string;
  /** Términos de búsqueda: [a-z0-9], al menos 2 caracteres (o un número). */
  terms: string[];
  /**
   * Operando de `to_tsquery('spanish', …)`: los términos unidos con `|`. Como cada término solo
   * tiene [a-z0-9], el usuario no puede inyectar operadores de tsquery. `null` si no hay términos.
   */
  tsquery: string | null;
  brand: string | null;
  attributes: VariantAttributes;
  /** La consulta pide un accesorio: no se penalizan las categorías de accesorios. */
  accessory: boolean;
}

/**
 * Interpreta la consulta del usuario. Los términos se combinan con OR: `ts_rank_cd` premia los
 * productos que contienen más términos y el umbral de §8.3 descarta los irrelevantes, así que
 * una palabra que no está en el catálogo ("nevera no frost 300 litros") no deja la búsqueda vacía,
 * pero una consulta sin ninguna palabra conocida sí devuelve vacío.
 */
export function parseQuery(q: string, brands: BrandDictionary): ParsedQuery {
  const text = normalizeText(q);
  const terms = [
    ...new Set(
      text
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 || /^\d$/.test(t))
        .slice(0, MAX_TERMS * 2),
    ),
  ].slice(0, MAX_TERMS);
  return {
    normalized: terms.join(' '),
    terms,
    tsquery: terms.length > 0 ? terms.join(' | ') : null,
    brand: normalizeBrand(null, text, brands),
    attributes: extractAttributes(text).attributes,
    accessory: terms.some((t) => ACCESSORY_TERMS.has(t)),
  };
}
