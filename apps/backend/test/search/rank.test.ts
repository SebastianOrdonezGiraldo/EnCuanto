import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_BONUS,
  discountPct,
  rankListing,
  summarize,
  type Candidate,
  type LiveOffer,
} from '../../src/modules/search/index';

const NOW = new Date('2026-11-19T12:00:00Z');
let seq = 0;
const offer = (
  productId: string,
  merchant: string,
  price: number,
  extra: Partial<LiveOffer> = {},
): LiveOffer => ({
  productId,
  offerId: `o${String(++seq).padStart(3, '0')}`,
  variantId: `${productId}-v1`,
  merchant,
  merchantName: merchant.toUpperCase(),
  price,
  listPrice: null,
  availability: 'in_stock',
  lastSeenAt: NOW,
  ...extra,
});
const cand = (
  productId: string,
  textScore: number,
  brand: string | null = 'kalora',
): Candidate => ({
  productId,
  textScore,
  brandKey: brand,
  brandName: brand ? brand[0]!.toUpperCase() + brand.slice(1) : null,
});
const text = { mode: 'text', sort: 'relevance' } as const;

describe('discountPct (§8.4)', () => {
  it('redondea a un decimal y es null sin precio de lista', () => {
    expect(discountPct(1_899_900, 2_499_900)).toBe(24);
    expect(discountPct(900, 470_000)).toBe(99.8);
    expect(discountPct(100, null)).toBeNull();
    expect(discountPct(100, 100)).toBeNull();
  });
});

describe('summarize', () => {
  it('la mejor oferta es la más barata que se puede comprar', () => {
    const s = summarize([
      offer('p', 'a', 90, { availability: 'out_of_stock' }),
      offer('p', 'b', 120),
      offer('p', 'c', 150, { availability: 'unknown', variantId: 'p-v2' }),
    ])!;
    expect(s.best.merchant).toBe('b');
    expect(s.minPrice).toBe(120);
    expect(s.maxPrice).toBe(150);
    expect(s.offerCount).toBe(3);
    expect(s.variantCount).toBe(2);
    expect(s.merchantCount).toBe(3);
    expect(s.inStock).toBe(true);
  });

  it('si todo está agotado, usa todas las ofertas', () => {
    const s = summarize([
      offer('p', 'a', 90, { availability: 'out_of_stock' }),
      offer('p', 'b', 80, { availability: 'out_of_stock' }),
    ])!;
    expect(s.minPrice).toBe(80);
    expect(s.inStock).toBe(false);
  });

  it('a igual precio gana la vista más reciente', () => {
    const s = summarize([
      offer('p', 'a', 100, { lastSeenAt: new Date('2026-11-19T10:00:00Z') }),
      offer('p', 'b', 100, { lastSeenAt: new Date('2026-11-19T11:00:00Z') }),
    ])!;
    expect(s.best.merchant).toBe('b');
  });
});

describe('rankListing (§8.3)', () => {
  it('umbral: sin productos con score > 0,05 responde vacío (nunca rellena)', () => {
    const r = rankListing(
      [cand('p1', 0.03)],
      [offer('p1', 'a', 100, { availability: 'unknown' })],
      { discountOnly: false },
      text,
    );
    expect(r.items).toEqual([]);
    expect(r.facets).toEqual({ merchants: [], brands: [], price: null });
  });

  it('la bonificación por stock puede superar el umbral y se suma al score', () => {
    const r = rankListing(
      [cand('p1', 0.03)],
      [offer('p1', 'a', 100)],
      { discountOnly: false },
      text,
    );
    expect(r.items[0]!.score).toBeCloseTo(0.03 + AVAILABILITY_BONUS);
  });

  it('ordena por score y desempata por precio mínimo', () => {
    const r = rankListing(
      [cand('p1', 0.2), cand('p2', 0.5), cand('p3', 0.2)],
      [offer('p1', 'a', 300), offer('p2', 'a', 500), offer('p3', 'a', 100)],
      { discountOnly: false },
      text,
    );
    expect(r.items.map((i) => i.productId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('productos sin ofertas vigentes no son resultados', () => {
    const r = rankListing(
      [cand('p1', 1), cand('p2', 1)],
      [offer('p2', 'a', 1)],
      { discountOnly: false },
      text,
    );
    expect(r.items.map((i) => i.productId)).toEqual(['p2']);
  });

  it.each([
    ['price_asc', ['p3', 'p1', 'p2']],
    ['price_desc', ['p2', 'p1', 'p3']],
    ['discount', ['p1', 'p3', 'p2']],
  ] as const)('orden %s', (sort, expected) => {
    const r = rankListing(
      [cand('p1', 0.3), cand('p2', 0.2), cand('p3', 0.1)],
      [
        offer('p1', 'a', 200, { listPrice: 400 }),
        offer('p2', 'a', 300),
        offer('p3', 'a', 100, { listPrice: 110 }),
      ],
      { discountOnly: false },
      { mode: 'text', sort },
    );
    expect(r.items.map((i) => i.productId)).toEqual(expected);
  });

  it('filtro de tienda: precios y conteos solo de esas tiendas', () => {
    const r = rankListing(
      [cand('p1', 1)],
      [offer('p1', 'a', 100), offer('p1', 'b', 80), offer('p1', 'c', 120)],
      { discountOnly: false, merchants: ['a', 'c'] },
      text,
    );
    expect(r.items[0]).toMatchObject({
      minPrice: 100,
      maxPrice: 120,
      offerCount: 2,
      merchantCount: 2,
    });
  });

  it('filtros de marca y precio', () => {
    const r = rankListing(
      [cand('p1', 1, 'kalora'), cand('p2', 1, 'nubrix'), cand('p3', 1, 'kalora')],
      [offer('p1', 'a', 100), offer('p2', 'a', 150), offer('p3', 'a', 500)],
      { discountOnly: false, brands: ['kalora'], minPrice: 50, maxPrice: 200 },
      text,
    );
    expect(r.items.map((i) => i.productId)).toEqual(['p1']);
  });

  it('discount_only: sin validación con historial (H5) no hay descuentos validados', () => {
    const r = rankListing(
      [cand('p1', 1)],
      [offer('p1', 'a', 100, { listPrice: 200 })],
      { discountOnly: true },
      text,
    );
    expect(r.items).toEqual([]);
  });

  it('facetas disyuntivas: cada una ignora su propio filtro', () => {
    const candidates = [cand('p1', 1, 'kalora'), cand('p2', 1, 'nubrix'), cand('p3', 1, 'kalora')];
    const offers = [
      offer('p1', 'a', 100),
      offer('p1', 'b', 900),
      offer('p2', 'b', 200),
      offer('p3', 'a', 300),
    ];
    const r = rankListing(
      candidates,
      offers,
      { discountOnly: false, merchants: ['a'], brands: ['kalora'], maxPrice: 250 },
      text,
    );
    expect(r.items.map((i) => i.productId)).toEqual(['p1']);
    // Tiendas: marca kalora y precio ≤ 250 con el precio de cada tienda → a: p1; b: ninguno (p1 en b cuesta 900).
    expect(r.facets.merchants).toEqual([{ slug: 'a', name: 'A', count: 1 }]);
    // Marcas: tienda a y precio ≤ 250 → kalora: p1; nubrix no tiene ofertas en a.
    expect(r.facets.brands).toEqual([{ name: 'Kalora', count: 1 }]);
    // Precio: tienda a y marca kalora → p1 (100) y p3 (300).
    expect(r.facets.price).toEqual({ min: 100, max: 300 });
  });

  it('listados sin texto: no aplica el umbral y prioriza stock y número de tiendas', () => {
    const r = rankListing(
      [cand('p1', 0), cand('p2', 0), cand('p3', 0)],
      [
        offer('p1', 'a', 100, { availability: 'out_of_stock' }),
        offer('p2', 'a', 300),
        offer('p3', 'a', 200),
        offer('p3', 'b', 250),
      ],
      { discountOnly: false },
      { mode: 'browse', sort: 'relevance' },
    );
    expect(r.items.map((i) => i.productId)).toEqual(['p3', 'p2', 'p1']);
  });

  it('el orden es estable entre ejecuciones (desempate por id)', () => {
    const candidates = [cand('pb', 1), cand('pa', 1)];
    const offers = [offer('pb', 'a', 100), offer('pa', 'a', 100)];
    const once = rankListing(candidates, offers, { discountOnly: false }, text).items;
    const twice = rankListing(
      [...candidates].reverse(),
      [...offers].reverse(),
      { discountOnly: false },
      text,
    ).items;
    expect(once.map((i) => i.productId)).toEqual(['pa', 'pb']);
    expect(twice).toEqual(once);
  });
});
