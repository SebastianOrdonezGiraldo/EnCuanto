import type { MetadataRoute } from 'next';
import { listCategories, listMerchants } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import { buildSitemap } from '@/lib/sitemap';

// Se genera en cada petición desde la BD (vía API), no en el build.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, merchants] = await Promise.all([
    listCategories()
      .then((r) => r.categories)
      .catch(() => []),
    listMerchants()
      .then((r) => r.merchants)
      .catch(() => []),
  ]);
  return buildSitemap(siteUrl(), categories, merchants);
}
