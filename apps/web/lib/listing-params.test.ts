import { describe, expect, it } from 'vitest';
import { hrefFor, parseListingParams, toApiParams, toQueryString } from './listing-params';

describe('parseListingParams', () => {
  it('acepta CSV y valores repetidos (formulario con casillas)', () => {
    const s = parseListingParams({
      q: '  nevera ',
      merchants: ['tienda-a', 'tienda-b,tienda-a'],
      brands: 'Kalora,Nubrix',
      min_price: '1.500.000',
      max_price: '$ 3000000',
      sort: 'price_asc',
      page: '2',
    });
    expect(s).toEqual({
      q: 'nevera',
      merchants: ['tienda-a', 'tienda-b'],
      brands: ['Kalora', 'Nubrix'],
      minPrice: 1_500_000,
      maxPrice: 3_000_000,
      sort: 'price_asc',
      page: 2,
    });
  });

  it('ignora valores inválidos en lugar de romper la página', () => {
    const s = parseListingParams({
      merchants: 'Tienda Mala,../x,ok-1',
      min_price: 'barato',
      sort: 'popular',
      page: '-3',
    });
    expect(s.merchants).toEqual(['ok-1']);
    expect(s.minPrice).toBeUndefined();
    expect(s.sort).toBe('relevance');
    expect(s.page).toBe(1);
  });

  it('intercambia un rango de precio invertido', () => {
    const s = parseListingParams({ min_price: '900', max_price: '100' });
    expect([s.minPrice, s.maxPrice]).toEqual([100, 900]);
  });
});

describe('URL canónica', () => {
  const state = parseListingParams({ q: 'tv 55"', merchants: 'b,a', sort: 'discount', page: '3' });

  it('omite valores por defecto y codifica la consulta', () => {
    expect(toQueryString(parseListingParams({ q: 'tv' }))).toBe('q=tv');
    expect(hrefFor('/buscar', state)).toBe(
      '/buscar?q=tv+55%22&merchants=b%2Ca&sort=discount&page=3',
    );
  });

  it('cambiar el orden vuelve a la página 1', () => {
    expect(hrefFor('/buscar', state, { sort: 'price_asc', page: 1 })).toBe(
      '/buscar?q=tv+55%22&merchants=b%2Ca&sort=price_asc',
    );
  });

  it('los parámetros de la API no llevan q y fijan page_size', () => {
    expect(toApiParams(state, 24).toString()).toBe(
      'merchants=b%2Ca&sort=discount&page=3&page_size=24',
    );
  });
});
