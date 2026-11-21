import type { VariantAttributes } from '@encuanto/db';
import {
  ACCESSORY_TERMS,
  extractAttributes,
  extractModelNumber,
  isSpecToken,
  normalizeText,
} from '../normalization/index';

/**
 * Preparación del título de una oferta para el matching (§8.2). Todo es puro y se calcula desde
 * `title_raw`, así que da lo mismo en el matching automático, en los tests y en la revisión.
 */

/** Palabras de venta que no describen el producto: se quitan del núcleo del título. */
const NOISE_WORDS = new Set([
  'nuevo',
  'nueva',
  'original',
  'oferta',
  'envio',
  'gratis',
  'obsequio',
  'regalo',
  'promo',
  'promocion',
  'sellado',
  'sellada',
  'garantia',
  'oficial',
  'exclusivo',
  'exclusiva',
  'liberado',
]);
const WARRANTY = /\bgarantia\s(?:de\s)?\d+\s(?:anos?|meses)\b/g;

/** Términos de accesorio que no están en la lista de la búsqueda pero sí abren títulos de accesorios. */
const EXTRA_ACCESSORY_TERMS = new Set(['bateria', 'baterias', 'lamina', 'pelicula', 'hidrogel']);
/** Combos y paquetes: el precio no es el de una unidad del producto. */
const BUNDLE = /\b(?:combo|kit|pack|paquete|bundle|x[2-9]|[2-9]x|[2-9]\sunidades)\b/;

/**
 * Sufijos que distinguen un modelo de otro de la misma línea ("Nova 12" frente a "Nova 12 Pro"):
 * cuentan como tokens de identidad aunque no tengan dígitos.
 */
const LINE_QUALIFIERS = new Set(['pro', 'max', 'plus', 'ultra', 'lite', 'mini', 'neo', 'fe', 'xl']);
/** Números que no distinguen un modelo de otro: redes (5g), resolución (4k). */
const GENERIC_NUMBERED = /^(?:[2-5]g|[48]k)$/;
/** Unidad separada del número ("50 mp", "120 hz"): se junta para reconocerla como especificación. */
const SPACED_UNIT =
  /(\d)\s(gb|tb|mb|mah|w|hz|mp|mm|cm|kg|btu|rpm|ghz|v|l|lt|lts|litros?|pulgadas?|pulg)\b/g;

export interface PreparedTitle {
  /** Título normalizado (§8.1.1). */
  normalized: string;
  /** Título sin atributos ni palabras de venta: lo que se compara con el nombre de la ficha. */
  core: string;
  attributes: VariantAttributes;
  modelNumber: string | null;
  /** Modelo sin guiones ni espacios, en mayúsculas (`SM-A566B` → `SMA566B`). */
  modelKey: string | null;
  /**
   * Tokens que identifican el producto: los que tienen dígitos ("12" de "Nova 12", el modelo, sin
   * guiones) y los sufijos de línea ("pro", "max", "lite"…).
   */
  identity: string[];
  /** El título empieza como el de un accesorio ("Funda para…", "Cargador…") o dice "compatible con". */
  accessory: boolean;
  /** Es un combo o paquete de varias unidades. */
  bundle: boolean;
}

export function modelKey(model: string | null | undefined): string | null {
  const key = model ? model.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  return key || null;
}

function coreOf(normalized: string, fragments: readonly string[]): string {
  let rest = normalized.replace(WARRANTY, ' ');
  for (const fragment of fragments) rest = rest.replace(fragment, ' ');
  return rest
    .split(/\s+/)
    .filter((t) => /[a-z0-9]/.test(t) && !NOISE_WORDS.has(t.replace(/[^a-z0-9]/g, '')))
    .join(' ');
}

/**
 * Tokens de identidad (sin especificaciones ni números genéricos): con dígitos o sufijos de línea.
 * El nivel 3 exige que coincidan: "Nova 12" no es "Nova 13" ni "Nova 12 Pro".
 */
export function identityTokens(core: string): string[] {
  const joined = core.replace(SPACED_UNIT, '$1$2');
  const out = new Set<string>();
  for (const raw of joined.split(/[^a-z0-9.,-]+/)) {
    const token = raw.replace(/^[-.,]+|[-.,]+$/g, '');
    if (LINE_QUALIFIERS.has(token)) {
      out.add(token);
      continue;
    }
    if (!/\d/.test(token) || isSpecToken(token) || GENERIC_NUMBERED.test(token)) continue;
    out.add(token.replace(/[-.,]/g, ''));
  }
  return [...out].sort();
}

/** Primeras palabras de un texto normalizado (para reconocer accesorios). */
function leadingWords(core: string, n: number): string[] {
  return core
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, n);
}

/** El texto (título o nombre de ficha, normalizado) describe un accesorio. */
export function looksLikeAccessory(core: string): boolean {
  const lead = leadingWords(core, 2);
  return (
    lead.some((w) => ACCESSORY_TERMS.has(w) || EXTRA_ACCESSORY_TERMS.has(w)) ||
    /\bcompatible con\b/.test(core) ||
    lead[0] === 'para'
  );
}

export function looksLikeBundle(core: string): boolean {
  return BUNDLE.test(core);
}

export function prepareTitle(titleRaw: string): PreparedTitle {
  const normalized = normalizeText(titleRaw);
  const { attributes, matched } = extractAttributes(normalized);
  const modelNumber = extractModelNumber(normalized, matched);
  const core = coreOf(normalized, matched);
  return {
    normalized,
    core,
    attributes,
    modelNumber,
    modelKey: modelKey(modelNumber),
    identity: identityTokens(core),
    accessory: looksLikeAccessory(core),
    bundle: looksLikeBundle(core),
  };
}

/** Nombre de una ficha (producto) ya guardada, preparado para compararlo con el núcleo del título. */
export function prepareName(canonicalName: string): {
  normalized: string;
  identity: string[];
  accessory: boolean;
  bundle: boolean;
} {
  const normalized = normalizeText(canonicalName);
  return {
    normalized,
    identity: identityTokens(normalized),
    accessory: looksLikeAccessory(normalized),
    bundle: looksLikeBundle(normalized),
  };
}

const MAX_NAME = 200;

/**
 * Nombre legible para una ficha nueva (nivel 5): el núcleo del título, sin el modelo, con las
 * palabras tal como las escribió la tienda (mayúsculas, tildes). Las palabras en mayúsculas sostenidas de más de
 * tres letras ("CELULAR") pasan a "Celular".
 */
export function displayName(
  titleRaw: string,
  core: string,
  modelNumber: string | null = null,
): string {
  const raw = titleRaw.split(/\s+/).filter(Boolean);
  const used = new Set<number>();
  // El modelo va en `model_number` (y en el índice de búsqueda), no en el nombre: así el nombre
  // se compara bien con los títulos que no lo traen.
  const model = modelNumber?.toLowerCase();
  const tokens = core.split(' ').filter((t) => !model || t !== model);
  const words = (tokens.length > 0 ? tokens : core.split(' ')).map((token) => {
    const i = raw.findIndex((w, j) => !used.has(j) && normalizeText(w) === token);
    if (i < 0) return token;
    used.add(i);
    const word = raw[i]!;
    return /^\p{Lu}{4,}$/u.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word;
  });
  const name = words.join(' ').trim();
  return (name || titleRaw.trim()).slice(0, MAX_NAME);
}

/** Categoría de la fuente para la ficha nueva: el último tramo de una ruta ("A > B > Celulares"). */
export function categoryName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .split(/[>/|»]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts.at(-1);
  return last ? last.slice(0, 80) : null;
}
