import { describe, expect, it } from 'vitest';
import {
  candidatesInMemory,
  categoryName,
  chooseVariant,
  compatible,
  decideMatch,
  displayName,
  identityTokens,
  looksLikeAccessory,
  looksLikeBundle,
  MAX_SIMILAR_PRODUCTS,
  modelConflict,
  prepareTitle,
  similarity,
  trigrams,
  type CandidateProduct,
} from '../../src/modules/matching/index';

const product = (over: Partial<CandidateProduct> & { id: string }): CandidateProduct => ({
  brand: 'kalora',
  canonicalName: 'Celular Kalora Nova 12',
  modelNumber: null,
  accessoryCategory: false,
  variants: [{ id: `${over.id}-v`, gtin: null, attributes: {} }],
  ...over,
});
const decide = (
  title: string,
  catalog: CandidateProduct[],
  extra: { gtin?: string; brand?: string | null } = {},
) => {
  const offer = {
    titleRaw: title,
    gtin: extra.gtin ?? null,
    brand: extra.brand === undefined ? 'kalora' : extra.brand,
  };
  return decideMatch(offer, candidatesInMemory(catalog, offer));
};

describe('trigramas (pg_trgm)', () => {
  it('rellena cada palabra con dos espacios delante y uno detrás, sin repetidos', () => {
    expect([...trigrams('ab')].sort()).toEqual(['  a', ' ab', 'ab ']);
    expect(trigrams('aa aa').size).toBe(3);
  });
  it('similitud = comunes / (|A| + |B| − comunes); 0 con un texto vacío', () => {
    expect(similarity('nova 12', 'nova 12')).toBe(1);
    expect(similarity('', 'nova')).toBe(0);
    expect(
      similarity('celular samsung galaxy a56 5g', 'celular samsung galaxy a36 5g'),
    ).toBeCloseTo(0.8182, 4);
  });
});

describe('preparación del título', () => {
  it('quita atributos, colores y palabras de venta del núcleo', () => {
    const t = prepareTitle(
      'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Negro + Obsequio Envío gratis',
    );
    expect(t.core).toBe('celular kalora nova 12 ka-n12');
    expect(t.attributes).toEqual({ storage_gb: 256, ram_gb: 8, color: 'negro' });
    expect(t.modelKey).toBe('KAN12');
  });
  it('quita la garantía ("Garantía 1 año")', () => {
    expect(prepareTitle('Licuadora Ondina Mix 600 Garantía 1 año').core).toBe(
      'licuadora ondina mix 600',
    );
  });
  it.each([
    ['celular kalora nova 12 ka-n12', ['12', 'kan12']],
    ['celular kalora nova 12 pro 5g', ['12', 'pro']],
    ['televisor 4k uhd 120hz', []],
    ['celular x 5000 mah 50 mp', []],
    ['portatil i5-1235u ddr5 wifi6', []],
  ])('tokens de identidad de %j', (core, expected) => {
    expect(identityTokens(core)).toEqual(expected);
  });
  it.each([
    ['funda para celular kalora nova 12', true],
    ['kalora funda nova 12', true],
    ['vidrio templado kalora nova 12', true],
    ['cargador compatible con kalora nova 12', true],
    ['licuadora ondina vaso de vidrio', false],
    ['celular kalora nova 12 con cargador', false],
  ])('accesorio: %j → %s', (core, expected) => {
    expect(looksLikeAccessory(core)).toBe(expected);
  });
  it.each([
    ['combo celular kalora nova 12 audifonos', true],
    ['audifonos lumbra calma x2', true],
    ['nevera kalora 2 puertas', false],
    ['pilas aa 2 unidades', true],
    ['celular kalora nova 12', false],
  ])('combo: %j → %s', (core, expected) => {
    expect(looksLikeBundle(core)).toBe(expected);
  });
  it('nombre de una ficha nueva: palabras de la tienda, sin modelo ni atributos', () => {
    const title = 'CELULAR KALORA Nova 12 KA-N12 128GB 6GB RAM Negro';
    const t = prepareTitle(title);
    expect(displayName(title, t.core, t.modelNumber)).toBe('Celular Kalora Nova 12');
    expect(
      displayName(
        'Freidora de Aire Ondina Crisp 4,5 L',
        prepareTitle('Freidora de Aire Ondina Crisp 4,5 L').core,
      ),
    ).toBe('Freidora de Aire Ondina Crisp');
  });
  it('categoría de la fuente: el último tramo de la ruta', () => {
    expect(categoryName('Tecnología > Celulares')).toBe('Celulares');
    expect(categoryName('Hogar / Electro / Neveras')).toBe('Neveras');
    expect(categoryName('  ')).toBeNull();
    expect(categoryName(null)).toBeNull();
  });
});

describe('compatibilidad de atributos y elección de variante (§8.2)', () => {
  it('un atributo presente en ambos y distinto bloquea; uno ausente no', () => {
    expect(compatible({ storage_gb: 256 }, { storage_gb: 128 })).toBe(false);
    expect(compatible({ storage_gb: 256 }, { storage_gb: 256, color: 'negro' })).toBe(true);
    expect(compatible({}, { color: 'negro' })).toBe(true);
  });
  const variants = [
    { id: 'negro', gtin: null, attributes: { storage_gb: 256, color: 'negro' } },
    { id: 'azul', gtin: null, attributes: { storage_gb: 256, color: 'azul' } },
  ];
  it('la única idéntica, la única compatible o ambigua', () => {
    expect(chooseVariant({ storage_gb: 256, color: 'azul' }, variants)).toMatchObject({
      kind: 'one',
      variant: { id: 'azul' },
    });
    expect(chooseVariant({ storage_gb: 256 }, variants)).toMatchObject({ kind: 'ambiguous' });
    expect(chooseVariant({ storage_gb: 512 }, variants)).toMatchObject({ kind: 'none' });
  });
  it('otro GTIN válido en la variante la hace incompatible', () => {
    const withGtin = [{ id: 'g', gtin: '1', attributes: {} }];
    expect(chooseVariant({}, withGtin, '2')).toMatchObject({ kind: 'none' });
    expect(chooseVariant({}, withGtin, '1')).toMatchObject({ kind: 'one' });
  });
});

describe('decisión (§8.2)', () => {
  it('nivel 1 se fía del GTIN salvo que la marca lo contradiga', () => {
    const catalog = [product({ id: 'p', variants: [{ id: 'v', gtin: 'G', attributes: {} }] })];
    expect(decide('Lo que sea', catalog, { gtin: 'G' })).toMatchObject({
      kind: 'auto',
      level: 1,
      variantId: 'v',
    });
    expect(decide('Celular Nubrix Pulse', catalog, { gtin: 'G', brand: 'nubrix' })).toMatchObject({
      kind: 'review',
      reason: 'gtin_conflicto',
    });
  });
  it('nivel 2 por debajo de la similitud mínima va a revisión (el "modelo" puede ser un token de especificación)', () => {
    const catalog = [
      product({ id: 'p', canonicalName: 'Portátil Kalora Book', modelNumber: 'KX-900' }),
    ];
    expect(decide('Mouse inalámbrico Kalora KX-900', catalog)).toMatchObject({
      kind: 'review',
      reason: 'modelo_poco_parecido',
    });
  });
  it('nivel 3 exige la misma marca; sin marca va a revisión', () => {
    const catalog = [product({ id: 'p' })];
    expect(decide('Celular Kalora Nova 12', catalog)).toMatchObject({ kind: 'auto', level: 3 });
    expect(decide('Celular Kalora Nova 12', catalog, { brand: null })).toMatchObject({
      kind: 'review',
      reason: 'sin_marca',
    });
    expect(decide('Celular Kalora Nova 12', [product({ id: 'p', brand: null })])).toMatchObject({
      kind: 'review',
      reason: 'sin_marca',
    });
  });
  it('una marca distinta descarta la ficha y otro modelo también', () => {
    expect(decide('Celular Zenkai Nova 12', [product({ id: 'p' })], { brand: 'zenkai' })).toEqual({
      kind: 'new_product',
      level: 5,
    });
    expect(
      decide('Celular Kalora Nova 12 KA-N12B', [product({ id: 'p', modelNumber: 'KA-N12' })]),
    ).toEqual({
      kind: 'new_product',
      level: 5,
    });
    expect(modelConflict('KAN12', 'KAN12B')).toBe(true);
    expect(modelConflict('KAN12', null)).toBe(false);
  });
  it('dos fichas que cumplen todas las reglas del nivel 3 van a revisión', () => {
    const catalog = [product({ id: 'p1' }), product({ id: 'p2' })];
    expect(decide('Celular Kalora Nova 12', catalog)).toMatchObject({
      kind: 'review',
      reason: 'ficha_ambigua',
    });
  });
  it(`el tope de fichas parecidas (${MAX_SIMILAR_PRODUCTS}) se informa y conserva las más parecidas`, () => {
    const catalog = Array.from({ length: MAX_SIMILAR_PRODUCTS + 10 }, (_, i) =>
      product({
        id: `p${String(i).padStart(3, '0')}`,
        canonicalName: `Funda para Celular Kalora Nova ${i}`,
      }),
    );
    catalog.push(
      product({
        id: 'buena',
        canonicalName: 'Funda para Celular Kalora Nova 12 Transparente',
        accessoryCategory: true,
      }),
    );
    const offer = {
      titleRaw: 'Funda para Celular Kalora Nova 12 Transparente',
      gtin: null,
      brand: 'kalora',
    };
    const c = candidatesInMemory(catalog, offer);
    expect(c.capped).toBe(true);
    expect(c.similar).toHaveLength(MAX_SIMILAR_PRODUCTS);
    expect(c.similar[0]!.id).toBe('buena');
    expect(decideMatch(offer, c)).toMatchObject({ kind: 'auto', level: 3, variantId: 'buena-v' });
  });
});
