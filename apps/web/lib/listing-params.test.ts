import { describe, expect, it } from 'vitest';
import {
  hrefFor,
  paginate,
  parseListingParams,
  toApiParams,
  toQueryString,
} from './listing-params';

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

  it('pagina todo el total: la página 101 y la última de 2.503 resultados son navegables', () => {
    const at = (page: string) => parseListingParams({ q: 'tv', page });
    const p101 = paginate('/buscar', at('101'), 2503, 24);
    expect(p101.pages).toBe(105);
    expect(p101.prev).toBe('/buscar?q=tv&page=100');
    expect(p101.next).toBe('/buscar?q=tv&page=102');
    expect(toApiParams(at('101'), 24).get('page')).toBe('101');

    const last = paginate('/buscar', at('105'), 2503, 24);
    expect(last.prev).toBe('/buscar?q=tv&page=104');
    expect(last.next).toBeNull();
    expect(toApiParams(at('105'), 24).get('page')).toBe('105');
  });

  it('acepta cualquier página entera positiva (el conjunto no se recorta)', () => {
    expect(parseListingParams({ page: '101' }).page).toBe(101);
    expect(parseListingParams({ page: '105' }).page).toBe(105);
    expect(parseListingParams({ page: '1.5' }).page).toBe(1);
    expect(parseListingParams({ page: '1e3' }).page).toBe(1);
    expect(parseListingParams({ page: '9999999999999999' }).page).toBe(1);
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
