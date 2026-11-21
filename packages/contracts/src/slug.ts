/**
 * Slug para URLs (§11): transliterado sin tildes ni eñes, en minúsculas y con guiones.
 * "Cámaras" → "camaras", "Nevecón" → "nevecon", "iPhone 15 Pro" → "iphone-15-pro".
 * Lo comparten la API (al crear categorías) y la web (sitemap y enlaces).
 */
export function slugify(input: string, maxLength = 80): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}
