import { describe, expect, it } from 'vitest';
import { boundedPayload, recordHash, toOfferOrQuarantine } from '../../src/modules/ingestion/index';
import { buildBrandDictionary } from '../../src/modules/normalization/index';

const dict = buildBrandDictionary(['Nubrix']);
const MERCHANT = '00000000-0000-4000-8000-000000000001';

describe('toOfferOrQuarantine', () => {
  it('normaliza una oferta válida', () => {
    const result = toOfferOrQuarantine(
      {
        externalId: 7,
        title: 'Celular Nubrix NX-1290 256GB Azul',
        url: 'https://tienda.example/p/7',
        price: '$1.299.900',
        listPrice: '$999.900', // menor que el precio → se descarta
        gtin: '2000000000015',
        availability: 'disponible',
      },
      MERCHANT,
      dict,
    );
    expect(result).toMatchObject({
      merchantId: MERCHANT,
      externalId: '7',
      price: 1299900,
      listPrice: null,
      gtin: '02000000000015',
      brand: 'nubrix',
      modelNumber: 'NX-1290',
      availability: 'in_stock',
      attributes: { storage_gb: 256, color: 'azul' },
    });
  });

  it.each([
    [{ title: 'Sin id', url: 'https://t.example/p', price: 1 }, 'invalid:externalId'],
    [{ externalId: '1', title: 'x', url: 'ftp://t.example/p', price: 1 }, 'invalid:url'],
    [
      { externalId: '1', title: 'x', url: 'https://t.example/p', price: 1, currency: 'USD' },
      'invalid:currency',
    ],
    [
      { externalId: '1', title: 'x', url: 'https://t.example/p', price: 1, condition: 'roto' },
      'invalid:condition',
    ],
    [{ externalId: '1', title: 'x', url: 'https://t.example/p', price: 'gratis' }, 'invalid_price'],
    ['no es un objeto', 'invalid:registro'],
  ])('manda a cuarentena %j con motivo %s', (record, reason) => {
    expect(toOfferOrQuarantine(record, MERCHANT, dict)).toMatchObject({ reason });
  });
});

describe('boundedPayload y recordHash', () => {
  it('acota textos, campos y profundidad', () => {
    const payload = boundedPayload({
      largo: 'x'.repeat(5000),
      a: { b: { c: { d: 1 } } },
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`z${String(i).padStart(3, '0')}`, i]),
      ),
    }) as Record<string, unknown>;
    expect((payload.largo as string).length).toBe(2000);
    expect(Object.keys(payload)).toHaveLength(60);
    expect(payload.a).toEqual({ b: { c: '[anidado]' } });
  });

  it('el hash no depende del orden de las claves', () => {
    expect(recordHash(boundedPayload({ a: 1, b: 2 }))).toBe(
      recordHash(boundedPayload({ b: 2, a: 1 })),
    );
  });
});
