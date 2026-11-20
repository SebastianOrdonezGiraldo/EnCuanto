import type { MetadataRoute } from 'next';

/** Entradas del sitemap (§11): inicio, categorías y tiendas, con los slugs de la BD. */
export function buildSitemap(
  base: string,
  categories: readonly { slug: string }[],
  merchants: readonly { slug: string }[],
  now: Date = new Date(),
): MetadataRoute.Sitemap {
  const url = (path: string) => `${base}${path}`;
  return [
    { url: url('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...categories.map((c) => ({
      url: url(`/categoria/${encodeURIComponent(c.slug)}`),
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
    ...merchants.map((m) => ({
      url: url(`/tienda/${encodeURIComponent(m.slug)}`),
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.6,
    })),
  ];
}
