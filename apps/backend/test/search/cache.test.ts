import { describe, expect, it, vi } from 'vitest';
import { ListingCache, type CacheStore } from '../../src/modules/search/index';

function memoryStore(): CacheStore & { data: Map<string, string>; ttl: Map<string, number> } {
  const data = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    data,
    ttl,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v, _mode, seconds) => {
      data.set(k, v);
      ttl.set(k, seconds);
      return 'OK';
    },
  };
}

const listing = {
  generatedAt: '2026-11-19T12:00:00.000Z',
  facets: {
    merchants: [{ slug: 'a', name: 'A', count: 1 }],
    brands: [],
    price: { min: 1, max: 1 },
  },
  items: [
    {
      productId: 'p1',
      score: 0.5,
      bestOfferId: 'o1',
      minPrice: 1,
      maxPrice: 2,
      offerCount: 3,
      variantCount: 1,
      merchantCount: 2,
    },
  ],
};

describe('ListingCache', () => {
  it('guarda el conjunto con TTL y lo devuelve igual', async () => {
    const store = memoryStore();
    const cache = new ListingCache(store, 600, { info() {}, warn() {}, error() {} });
    await cache.set('k', listing);
    expect(store.ttl.get('k')).toBe(600);
    expect(await cache.get('k')).toEqual(listing);
    expect(await cache.version()).toBe('0');
  });

  it('si Redis falla, avisa sin la clave y sigue sin caché', async () => {
    const warn = vi.fn();
    const broken: CacheStore = {
      get: async () => {
        throw new Error('Connection is closed.');
      },
      set: async () => {
        throw new Error('Connection is closed.');
      },
    };
    const cache = new ListingCache(broken, 600, { info() {}, warn, error() {} });
    expect(await cache.version()).toBeNull();
    expect(await cache.get('search:v1:abc')).toBeNull();
    await expect(cache.set('search:v1:abc', listing)).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('search:v1');
  });

  it('sin store no hace nada', async () => {
    const cache = new ListingCache(null, 600, { info() {}, warn() {}, error() {} });
    expect(await cache.version()).toBeNull();
    expect(await cache.get('k')).toBeNull();
  });
});
