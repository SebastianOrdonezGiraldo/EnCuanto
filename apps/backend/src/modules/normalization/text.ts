/**
 * Normalización de texto (§8.1.1): NFKC → minúsculas → sin tildes → espacios colapsados.
 * Quita ®, ™ y © (NFKC convertiría ™ en "tm"). Equivale a `lower(unaccent(...))` de PostgreSQL: la ñ también pasa a n, igual que en la BD.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[®™©]/gu, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
}
