/** URL del backend para las peticiones del servidor de Next (SSR y route handlers). */
export function apiBaseUrl(): string {
  return (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:4000'
  ).replace(/\/+$/, '');
}

/** URL pública de la web, para el sitemap y las URL canónicas. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
