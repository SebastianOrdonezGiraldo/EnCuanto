import { describe, expect, it } from 'vitest';
import {
  normalizeGtin,
  normalizePrices,
  normalizeText,
  parsePriceCop,
} from '../../src/modules/normalization/index';

describe('normalizeText (§8.1.1)', () => {
  it.each([
    ['  Nevecón   ÁRTICO  ', 'nevecon artico'],
    ['Cámara  Fotográfica\tDigital', 'camara fotografica digital'],
    ['Licuadora Ñandú 1,5 L', 'licuadora nandu 1,5 l'],
    ['ＴＶ\u3000５５\u00a0pulgadas', 'tv 55 pulgadas'], // ancho completo y espacio duro (NFKC)
    ['Audífonos Inalámbricos™ Pro®', 'audifonos inalambricos pro'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('normalizeGtin (§8.1.5)', () => {
  it.each([
    ['7702001041015', '07702001041015'], // EAN-13
    ['4006381333931', '04006381333931'], // EAN-13
    ['96385074', '00000096385074'], // EAN-8
    ['036000291452', '00036000291452'], // UPC-A (GTIN-12)
    ['10012345678902', '10012345678902'], // GTIN-14
    ['770-2001-041015', '07702001041015'], // con guiones
    [' 4006381333931 ', '04006381333931'], // con espacios
  ])('acepta %j', (input, expected) => {
    expect(normalizeGtin(input)).toBe(expected);
  });

  it.each([
    ['7702001041016'], // dígito de control incorrecto
    ['400638133393'], // 12 dígitos con control incorrecto
    ['12345'], // longitud inválida
    ['77020010410AB'], // letras
    ['0000000000000'], // todo ceros
    [''],
  ])('rechaza %j', (input) => {
    expect(normalizeGtin(input)).toBeNull();
  });

  it('UPC-A y su EAN-13 equivalente dan el mismo GTIN', () => {
    expect(normalizeGtin('036000291452')).toBe(normalizeGtin('0036000291452'));
  });

  it('acepta números y null', () => {
    expect(normalizeGtin(4006381333931)).toBe('04006381333931');
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin(undefined)).toBeNull();
  });
});

describe('parsePriceCop (§8.1.6)', () => {
  it.each<[string | number, number | null]>([
    [1899900, 1899900],
    ['1899900', 1899900],
    ['$1.899.900', 1899900],
    ['$ 1.899.900', 1899900],
    ['1899900.00 COP', 1899900],
    ['1.899.900,50', 1899901],
    ['COP 1,899,900', 1899900],
    ['1,899,900.00', 1899900],
    ['89.900', 89900],
    ['89900,4', 89900],
    [1899900.49, 1899900],
    ['0', null],
    [-5000, null],
    ['gratis', null],
    ['1.89.900', null],
    ['', null],
    [Number.NaN, null],
    [1e15, null],
  ])('%j → %j', (input, expected) => {
    expect(parsePriceCop(input)).toBe(expected);
  });
});

describe('normalizePrices (§8.1.6)', () => {
  it('conserva list_price mayor que price', () => {
    expect(normalizePrices('1.899.900', '2.499.900')).toEqual({
      price: 1899900,
      listPrice: 2499900,
    });
  });

  it('list_price menor que price → null', () => {
    expect(normalizePrices(500000, 400000)).toEqual({ price: 500000, listPrice: null });
  });

  it('list_price inválido → null, precio intacto', () => {
    expect(normalizePrices(500000, 'n/a')).toEqual({ price: 500000, listPrice: null });
  });

  it('precio inválido → null', () => {
    expect(normalizePrices(0, 100)).toBeNull();
  });
});
