import { normalizeText } from './text';

/**
 * Alias conocidos → nombre normalizado de la marca (§8.1.2). Se suman a los
 * `brands.normalized_name` de la BD. Solo nombres genéricos de marca, sin datos de terceros.
 */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  'lg electronics': 'lg',
  'samsung electronics': 'samsung',
  'hewlett packard': 'hp',
  'hewlett-packard': 'hp',
  'hp inc': 'hp',
  'apple inc': 'apple',
  'sony corporation': 'sony',
  'xiaomi corporation': 'xiaomi',
  'motorola mobility': 'motorola',
};

/** Diccionario de marcas: forma normalizada de cada alias o nombre → nombre normalizado canónico. */
export type BrandDictionary = ReadonlyMap<string, string>;

/** Clave de comparación: texto normalizado sin puntuación de razón social. */
export function brandKey(raw: string): string {
  return normalizeText(raw)
    .replace(/[.,]/g, '')
    .replace(/\s+(s\.?a\.?s?|ltda|inc|corp|co)$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Construye el diccionario con las marcas conocidas (`brands.normalized_name`) y los alias. */
export function buildBrandDictionary(knownBrands: Iterable<string> = []): BrandDictionary {
  const dict = new Map<string, string>();
  for (const name of knownBrands) {
    const key = brandKey(name);
    if (key) dict.set(key, key);
  }
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    dict.set(brandKey(alias), canonical);
  }
  return dict;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Marca normalizada de una oferta. Si la fuente trae marca, se traduce por el diccionario (o se
 * deja normalizada si es desconocida). Si no la trae, se busca en el título la marca conocida
 * que aparece primero (a igual posición, la más larga). `null` si no hay ninguna.
 */
export function normalizeBrand(
  rawBrand: string | null | undefined,
  normalizedTitle: string,
  dict: BrandDictionary,
): string | null {
  if (rawBrand && rawBrand.trim()) {
    const key = brandKey(rawBrand);
    if (key) return dict.get(key) ?? key;
  }
  let best: { index: number; length: number; brand: string } | null = null;
  for (const [alias, canonical] of dict) {
    const m = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(alias)}(?=$|[^a-z0-9])`).exec(
      normalizedTitle,
    );
    if (!m) continue;
    const index = m.index;
    if (!best || index < best.index || (index === best.index && alias.length > best.length)) {
      best = { index, length: alias.length, brand: canonical };
    }
  }
  return best?.brand ?? null;
}
