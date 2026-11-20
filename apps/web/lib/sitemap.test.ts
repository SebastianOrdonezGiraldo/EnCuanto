import { slugify } from '@encuanto/contracts';
import { describe, expect, it } from 'vitest';
import { buildSitemap } from './sitemap';

describe('buildSitemap (§11)', () => {
  it('usa slugs transliterados para categorías y tiendas', () => {
    const categories = ['Cámaras', 'Nevecón', 'iPhone'].map((name) => ({ slug: slugify(name) }));
    const urls = buildSitemap('https://encuanto.example', categories, [
      { slug: 'tienda-aurora' },
    ]).map((e) => e.url);
    expect(urls).toEqual([
      'https://encuanto.example/',
      'https://encuanto.example/categoria/camaras',
      'https://encuanto.example/categoria/nevecon',
      'https://encuanto.example/categoria/iphone',
      'https://encuanto.example/tienda/tienda-aurora',
    ]);
  });
});
