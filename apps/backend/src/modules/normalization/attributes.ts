import type { VariantAttributes } from '@encuanto/db';

/**
 * Extracción de atributos del título (§8.1.3). Trabaja sobre texto ya normalizado con
 * `normalizeText` (minúsculas y sin tildes). Las reglas siguen las expresiones de §8.1 con
 * dos ampliaciones documentadas en los tests: RAM con "+" (`8+256gb`) y la heurística de dos
 * capacidades sin la palabra "ram" (`256gb/8gb`).
 */

/** Tecnología de memoria entre la capacidad y la palabra RAM: `ram ddr4 16gb`, `16gb ddr5`. */
const DDR = String.raw`(?:lp)?ddr\d+x?`;
const RAM_PATTERNS = [
  new RegExp(String.raw`\b(\d{1,3})\s?gb\s?(?:de\s)?(?:memoria\s)?(?:${DDR}\s?)?ram\b`, 'g'),
  new RegExp(String.raw`\bram\s?(?:de\s)?(?:${DDR}\s?)?(\d{1,3})\s?gb\b`, 'g'),
];
/**
 * Sin la palabra RAM, una tecnología DDR pegada a la capacidad también identifica RAM. Solo se
 * aplica si no se encontró RAM explícita: en "16gb ram 512gb ddr5" el 512 no es RAM. Primero
 * "16gb ddr5" (lo habitual): en "16gb ddr5 512gb ssd" la DDR ya queda consumida y el 512 no es RAM.
 */
const DDR_PATTERNS = [
  new RegExp(String.raw`\b(\d{1,3})\s?gb\s?${DDR}\b`, 'g'),
  new RegExp(String.raw`\b${DDR}\s?(\d{1,3})\s?gb\b`, 'g'),
];
/** `8+256gb`, `8gb+256gb`: RAM + almacenamiento, habitual en celulares. */
const RAM_PLUS_STORAGE = /\b(\d{1,2})\s?(?:gb)?\s?\+\s?(\d{2,4})\s?(gb|tb)\b/;
const STORAGE = /\b(\d+(?:[.,]\d+)?)\s?(gb|tb)\b/g;
const LITERS = /\b(\d+(?:[.,]\d+)?)\s?(?:l|lt|lts|litros?)\b/;
const SCREEN = /\b(\d{1,3}(?:[.,]\d)?)\s?(?:"|”|“|''|′′|″|pulgadas?\b|pulg\b)/;
/**
 * Kilos (H3): ampliación de §8.1.3. En lavadoras y secadoras la capacidad en kg distingue la
 * variante ("Lavadora 17 Kg" frente a "19 Kg" del mismo modelo); sin ella, el matching las
 * confundiría.
 */
const WEIGHT = /\b(\d{1,3}(?:[.,]\d{1,2})?)\s?(?:kg|kgs|kilos?|kilogramos?)\b/;

/** Colores admitidos (lista cerrada) y sus variantes de género, plural e inglés. */
const COLOR_ALIASES: Record<string, string> = {
  negro: 'negro',
  negra: 'negro',
  black: 'negro',
  blanco: 'blanco',
  blanca: 'blanco',
  white: 'blanco',
  gris: 'gris',
  gray: 'gris',
  grey: 'gris',
  grafito: 'gris',
  plata: 'plata',
  plateado: 'plata',
  plateada: 'plata',
  silver: 'plata',
  azul: 'azul',
  blue: 'azul',
  rojo: 'rojo',
  roja: 'rojo',
  red: 'rojo',
  verde: 'verde',
  green: 'verde',
  amarillo: 'amarillo',
  amarilla: 'amarillo',
  yellow: 'amarillo',
  rosado: 'rosado',
  rosada: 'rosado',
  rosa: 'rosado',
  pink: 'rosado',
  morado: 'morado',
  morada: 'morado',
  violeta: 'morado',
  lila: 'morado',
  purple: 'morado',
  dorado: 'dorado',
  dorada: 'dorado',
  gold: 'dorado',
  naranja: 'naranja',
  orange: 'naranja',
  beige: 'beige',
  cafe: 'cafe',
  marron: 'cafe',
  brown: 'cafe',
};
const COLOR = new RegExp(`\\b(${Object.keys(COLOR_ALIASES).join('|')})\\b`);

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

export interface ExtractedAttributes {
  attributes: VariantAttributes;
  /** Fragmentos del título que se reconocieron como atributos (para excluirlos del modelo). */
  matched: string[];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Quita de un texto normalizado los fragmentos reconocidos como atributos, cada uno como palabra
 * completa: el color "red" de "Redmi Note 12 Red" no se borra dentro de "Redmi".
 */
export function removeFragments(text: string, fragments: readonly string[]): string {
  let rest = text;
  for (const fragment of fragments) {
    if (!fragment) continue;
    const start = /^[a-z0-9]/.test(fragment) ? '(?<![a-z0-9])' : '';
    const end = /[a-z0-9]$/.test(fragment) ? '(?![a-z0-9])' : '';
    rest = rest.replace(new RegExp(`${start}${escapeRegExp(fragment)}${end}`), ' ');
  }
  return rest;
}

/** Extrae color, almacenamiento, RAM, litros, pulgadas y kilos de un título normalizado. */
export function extractAttributes(text: string): ExtractedAttributes {
  const attributes: VariantAttributes = {};
  const matched: string[] = [];
  let rest = text;

  const takeRam = (pattern: RegExp) => {
    rest = rest.replace(pattern, (m: string, gb: string) => {
      attributes.ram_gb ??= Number(gb);
      matched.push(m);
      return ' ';
    });
  };
  RAM_PATTERNS.forEach(takeRam);
  if (attributes.ram_gb === undefined) DDR_PATTERNS.forEach(takeRam);

  const plus = RAM_PLUS_STORAGE.exec(rest);
  if (plus && attributes.ram_gb === undefined) {
    attributes.ram_gb = Number(plus[1]);
    attributes.storage_gb = toNumber(plus[2]!) * (plus[3] === 'tb' ? 1024 : 1);
    matched.push(plus[0]);
    rest = removeFragments(rest, [plus[0]]);
  }

  if (attributes.storage_gb === undefined) {
    const sizes: number[] = [];
    for (const m of rest.matchAll(STORAGE)) {
      sizes.push(toNumber(m[1]!) * (m[2] === 'tb' ? 1024 : 1));
      matched.push(m[0]);
    }
    if (sizes.length > 0) {
      const max = Math.max(...sizes);
      const min = Math.min(...sizes);
      attributes.storage_gb = max;
      // Dos capacidades sin "ram" (p. ej. "256gb/8gb"): la pequeña es la RAM.
      if (attributes.ram_gb === undefined && sizes.length >= 2 && min <= 24 && max >= 32) {
        attributes.ram_gb = min;
      }
    }
  }

  const liters = LITERS.exec(rest);
  if (liters) {
    attributes.capacity_l = toNumber(liters[1]!);
    matched.push(liters[0]);
  }

  const screen = SCREEN.exec(rest);
  if (screen) {
    const inches = toNumber(screen[1]!);
    if (inches >= 1 && inches <= 120) {
      attributes.screen_in = inches;
      matched.push(screen[0]);
    }
  }

  const weight = WEIGHT.exec(rest);
  if (weight) {
    attributes.weight_kg = toNumber(weight[1]!);
    matched.push(weight[0]);
  }

  const color = COLOR.exec(rest);
  if (color) {
    attributes.color = COLOR_ALIASES[color[1]!];
    matched.push(color[0]);
  }

  return { attributes, matched };
}
