/**
 * Similitud de trigramas idéntica a `similarity()` de `pg_trgm` (PostgreSQL 16), para decidir el
 * matching (§8.2) en TypeScript con los mismos números que daría la BD. Un test de integración la
 * compara con la de PostgreSQL sobre el set de prueba.
 *
 * Como `pg_trgm`: cada palabra (secuencia de letras y dígitos) se rellena con dos espacios
 * delante y uno detrás, se sacan sus trigramas, se eliminan repetidos y
 * similitud = comunes / (|A| + |B| − comunes). Espera texto ya normalizado (minúsculas, sin
 * tildes), igual que `immutable_unaccent(lower(...))` en la BD.
 */
const WORD = /[\p{L}\p{N}]+/gu;

export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(WORD)) {
    const chars = [' ', ' ', ...match[0], ' '];
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars[i]! + chars[i + 1]! + chars[i + 2]!);
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  // PostgreSQL devuelve real (float4): se redondea igual para comparar umbrales con los mismos bits.
  return Math.fround(common / (ta.size + tb.size - common));
}
