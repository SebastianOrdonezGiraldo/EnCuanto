import { describe, expect, it } from 'vitest';
import { freshnessOf, listingQuerySchema, searchQuerySchema, slugify } from './index';

describe('searchQuerySchema (§7)', () => {
  it('aplica valores por defecto y convierte los CSV', () => {
    const r = searchQuerySchema.parse({ q: ' nevera ', merchants: 'tienda-a, tienda-b,,tienda-a' });
    expect(r).toEqual({
      q: 'nevera',
      merchants: ['tienda-a', 'tienda-b'],
      discount_only: false,
      sort: 'relevance',
      page: 1,
      page_size: 24,
    });
  });

  it.each([
    [{ q: 'a' }],
    [{ q: 'x'.repeat(101) }],
    [{ q: 'tv', page_size: '49' }],
    [{ q: 'tv', page: '0' }],
    [{ q: 'tv', page: '1.5' }],
    [{ q: 'tv', page: '9007199254740992' }],
    [{ q: 'tv', sort: 'popular' }],
    [{ q: 'tv', min_price: '-1' }],
    [{ q: 'tv', min_price: '10', max_price: '5' }],
    [{ q: 'tv', merchants: 'Tienda Mayúscula' }],
    [{ q: 'tv', discount_only: 'si' }],
    [{ q: ['tv', 'nevera'] }],
  ])('rechaza %j', (input) => {
    expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });

  it('no limita el número de página (el conjunto no se recorta)', () => {
    expect(searchQuerySchema.parse({ q: 'tv', page: '101' }).page).toBe(101);
    expect(searchQuerySchema.parse({ q: 'tv', page: '5000' }).page).toBe(5000);
  });

  it('el listado no exige q', () => {
    expect(listingQuerySchema.parse({ discount_only: '1' }).discount_only).toBe(true);
  });
});

describe('freshnessOf (§8.5)', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  it.each([
    [1, 'fresh'],
    [23.9, 'fresh'],
    [24, 'stale'],
    [72, 'stale'],
    [72.1, 'hidden'],
  ] as const)('%d h → %s', (h, expected) => {
    expect(freshnessOf(hoursAgo(h), now)).toBe(expected);
  });
});

describe('slugify (§11)', () => {
  it.each([
    ['Cámaras', 'camaras'],
    ['Nevecón', 'nevecon'],
    ['iPhone 15 Pro', 'iphone-15-pro'],
    ['Portátiles', 'portatiles'],
    ['  Audífonos & Parlantes!! ', 'audifonos-parlantes'],
    ['Niño', 'nino'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
