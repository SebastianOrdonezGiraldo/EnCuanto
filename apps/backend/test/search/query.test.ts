import { describe, expect, it } from 'vitest';
import { buildBrandDictionary } from '../../src/modules/normalization/index';
import { cacheKey, parseQuery, scrubQuery } from '../../src/modules/search/index';

const brands = buildBrandDictionary(['kalora', 'nubrix', 'lg']);

describe('parseQuery', () => {
  it('normaliza, separa términos y los une con OR para to_tsquery', () => {
    const p = parseQuery('  Nevera NO FROST 300 litros ', brands);
    expect(p.terms).toEqual(['nevera', 'no', 'frost', '300', 'litros']);
    expect(p.tsquery).toBe('nevera | no | frost | 300 | litros');
    expect(p.attributes).toEqual({ capacity_l: 300 });
    expect(p.accessory).toBe(false);
  });

  it('quita tildes y detecta la marca', () => {
    const p = parseQuery('Portátil KALORA 16GB RAM', brands);
    expect(p.normalized).toBe('portatil kalora 16gb ram');
    expect(p.brand).toBe('kalora');
    expect(p.attributes).toMatchObject({ ram_gb: 16 });
  });

  it.each(["nevera' | !celular & (tv)", 'a:* <-> b', '\\x00 drop table products;--'])(
    'los operadores de tsquery no llegan a la consulta: %s',
    (q) => {
      const p = parseQuery(q, brands);
      expect(p.tsquery ?? '').toMatch(/^([a-z0-9]+( \| [a-z0-9]+)*)?$/);
    },
  );

  it('sin términos útiles no hay tsquery', () => {
    expect(parseQuery('¿¡!? -- ..', brands).tsquery).toBeNull();
  });

  it('reconoce consultas de accesorios', () => {
    expect(parseQuery('funda celular', brands).accessory).toBe(true);
  });

  it('limita el número de términos', () => {
    const q = Array.from({ length: 40 }, (_, i) => `t${i}`).join(' ');
    expect(parseQuery(q, brands).terms).toHaveLength(12);
  });
});

describe('scrubQuery (search_queries sin datos personales)', () => {
  it('quita correos y números largos antes de normalizar', () => {
    expect(scrubQuery('Celular para juan.perez@correo.example 3001234567')).toBe(
      'celular para [email] [numero]',
    );
  });

  it('deja intactas las consultas normales', () => {
    expect(scrubQuery('Nevera No Frost 300 L')).toBe('nevera no frost 300 l');
  });
});

describe('cacheKey (§8.6)', () => {
  it('incluye la versión de catálogo y no la consulta en claro', () => {
    const key = cacheKey('search', '7', { q: 'nevera', f: {}, s: 'relevance' });
    expect(key).toMatch(/^search:v7:[0-9a-f]{40}$/);
    expect(key).not.toContain('nevera');
  });

  it('cambia con la versión, los filtros o el orden', () => {
    const base = { q: 'nevera', f: {}, s: 'relevance' };
    const k = cacheKey('search', '1', base);
    expect(cacheKey('search', '2', base)).not.toBe(k);
    expect(cacheKey('search', '1', { ...base, s: 'price_asc' })).not.toBe(k);
    expect(cacheKey('search', '1', { ...base, f: { merchants: ['a'] } })).not.toBe(k);
    expect(cacheKey('search', '1', { ...base })).toBe(k);
  });
});
