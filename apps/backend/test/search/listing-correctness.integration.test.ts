import { createDb, type DbClient } from '@encuanto/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { upsertCatalog, type CatalogEntryInput } from '../../src/modules/catalog/index';
import { ListingCache, SearchService, type CacheStore } from '../../src/modules/search/index';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Más coincidencias que el antiguo recorte de 1.500 candidatos y más de 100 páginas de 24 (el
 * antiguo tope de página).
 */
const MANY = 2500;

const log = { info() {}, warn() {}, error() {} };

type Sql = DbClient['sql'];

/**
 * `sql` que retrasa `ms` la entrega del resultado de la consulta de listados (la que calcula
 * `valid_for_s`): la BD ya midió la validez y la API la recibe más tarde.
 */
function delayListingQuery(sql: Sql, ms: number): Sql {
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      const query = Reflect.apply(target, thisArg, args) as PromiseLike<unknown> & object;
      const strings = args[0];
      if (!Array.isArray(strings) || !strings.join('').includes('valid_for_s')) return query;
      return new Proxy(query, {
        get(t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
              t
                .then(async (rows) => {
                  await new Promise((r) => setTimeout(r, ms));
                  return rows;
                })
                .then(ok, fail);
          }
          const v = Reflect.get(t, prop, t) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      });
    },
  });
}

/**
 * Casos de la revisión de H2: el universo de resultados no se recorta antes de filtrar y
 * ordenar, y la caché no sobrevive a la caducidad (§8.5) de las ofertas con las que se calculó.
 */
describe.skipIf(!DATABASE_URL)('listados: universo completo y caché con frescura', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let app: ReturnType<typeof buildApp>;
  const data = new Map<string, string>();
  const store: CacheStore = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
  };

  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'listing');
    client = createDb(isolated.url, { max: 4 });
    await client.sql`
      insert into merchants (slug, name, source_type)
      values ('tienda-grande', 'Tienda Grande', 'manual'), ('tienda-unica', 'Tienda Única', 'manual')`;

    // MANY productos que coinciden con "zorblax". Los tres especiales tienen el nombre más
    // largo (menos similitud de trigramas, así que puntúan por debajo del resto) y son el más
    // barato, el único de su marca y el único de su tienda.
    const entries: CatalogEntryInput[] = Array.from({ length: MANY }, (_, i) => ({
      category: { name: 'Gadgets' },
      brand: 'Comun',
      canonicalName: `Zorblax ${i}`,
      modelNumber: `ZB-${i}`,
      variants: [{ key: `z${i}`, gtin: null, attributes: {} }],
    }));
    const special = (key: string, brand: string): CatalogEntryInput => ({
      category: { name: 'Gadgets' },
      brand,
      canonicalName: `Zorblax edicion especial de coleccion numerada ${key}`,
      modelNumber: `ZB-${key}`,
      variants: [{ key, gtin: null, attributes: {} }],
    });
    entries.push(
      special('barato', 'Comun'),
      special('marca', 'Minoritaria'),
      special('tienda', 'Comun'),
    );
    const variants = await upsertCatalog(client.db, entries);

    const rows = [...variants.entries()].map(([key, variantId], i) => ({
      key,
      variantId,
      merchant: key === 'tienda' ? 'tienda-unica' : 'tienda-grande',
      price: key === 'barato' ? 1 : 1000 + i,
    }));
    await client.sql`
      insert into offers (merchant_id, external_id, title_raw, url, price, availability, variant_id, match_status)
      select m.id, r.key, 'Zorblax', 'https://t.example/p/' || r.key, r.price, 'in_stock', r.variant::uuid, 'manual'
        from jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ ...r, variant: r.variantId })))}::jsonb)
             as r(key text, variant text, merchant text, price int)
        join merchants m on m.slug = r.merchant`;
    await client.sql`vacuum analyze`;

    app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: 0,
      },
      search: new SearchService({
        client,
        cache: new ListingCache(store, 600, log),
        log,
        weights: { text: 1, trgm: 0.5 },
        logQueries: false,
      }),
    });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await isolated?.drop();
  });

  it('total, orden y filtros cubren todas las coincidencias', async () => {
    const all = await get('/api/search?q=zorblax&page_size=48');
    expect(all.total).toBe(MANY + 3);

    const cheapest = await get('/api/search?q=zorblax&sort=price_asc');
    expect(cheapest.results[0].min_price).toBe(1);
    expect(cheapest.results[0].name).toMatch(/barato$/);

    const brand = await get('/api/search?q=zorblax&brands=Minoritaria');
    expect(brand.total).toBe(1);
    expect(brand.results[0].name).toMatch(/marca$/);
    expect(all.facets.brands).toContainEqual({ name: 'Minoritaria', count: 1 });

    const merchant = await get('/api/search?q=zorblax&merchants=tienda-unica');
    expect(merchant.total).toBe(1);
    expect(merchant.results[0].name).toMatch(/tienda$/);
    expect(all.facets.merchants).toContainEqual({
      slug: 'tienda-unica',
      name: 'Tienda Única',
      count: 1,
    });

    // Todas las páginas que se derivan del total son navegables, también pasada la 100.
    const last = Math.ceil(all.total / 24);
    expect(last).toBe(105);
    const page101 = await get('/api/search?q=zorblax&page_size=24&page=101');
    expect(page101.page).toBe(101);
    expect(page101.results).toHaveLength(24);
    const lastPage = await get(`/api/search?q=zorblax&page_size=24&page=${last}`);
    expect(lastPage.results).toHaveLength(all.total - (last - 1) * 24);
    // Las páginas no se solapan: el conjunto ordenado es estable.
    const ids = new Set<string>();
    for (const page of [100, 101, 102]) {
      const p = await get(`/api/search?q=zorblax&page_size=24&page=${page}`);
      for (const r of p.results) ids.add(r.product_id);
    }
    expect(ids.size).toBe(72);
    // Más allá del final: vacío, con el total real.
    const beyond = await get(`/api/search?q=zorblax&page_size=24&page=${last + 1}`);
    expect(beyond.results).toEqual([]);
    expect(beyond.total).toBe(all.total);
  });

  it('la demora entre la BD y la API no alarga la validez de la caché', async () => {
    await upsertCatalog(client.db, [
      {
        category: { name: 'Gadgets' },
        brand: 'Comun',
        canonicalName: 'Vexoran Dos',
        modelNumber: 'VX-2',
        variants: [{ key: 'vx', gtin: null, attributes: {} }],
      },
    ]);
    // La más barata caduca a los 1,5 s; la consulta tarda 3 s más en llegar a la API.
    await client.sql`
      insert into offers (merchant_id, external_id, title_raw, url, price, availability, variant_id, match_status, last_seen_at)
      select m.id, x.ext, 'Vexoran Dos', 'https://t.example/p/' || x.ext, x.price, 'in_stock', v.id, 'manual', x.seen
        from (values ('tienda-grande', 'VX-A', 100, now() - interval '72 hours' + interval '1.5 seconds'),
                     ('tienda-unica',  'VX-B', 200, now())) as x(merchant, ext, price, seen)
        join merchants m on m.slug = x.merchant
        cross join (select pv.id from product_variants pv join products p on p.id = pv.product_id
                     where p.model_number = 'VX-2') v`;

    const shared = new Map<string, string>();
    const sharedStore: CacheStore = {
      get: async (k) => shared.get(k) ?? null,
      set: async (k, v) => void shared.set(k, v),
    };
    const service = (sql: Sql) =>
      new SearchService({
        client: { ...client, sql },
        cache: new ListingCache(sharedStore, 600, log),
        log,
        weights: { text: 1, trgm: 0.5 },
        logQueries: false,
      });
    const query = {
      q: 'vexoran',
      sort: 'relevance',
      page: 1,
      page_size: 24,
      discount_only: false,
    } as const;

    // Calculado con la oferta de 100 todavía vigente, recibido 3 s después (ya caducada).
    const slow = await service(delayListingQuery(client.sql, 3000)).search(query);
    expect(slow.cache.hit).toBe(false);

    // Misma versión y mismo store: el conjunto no debe servirse, porque su validez se mide desde
    // antes de la consulta, no desde que llegó la respuesta.
    const after = await service(client.sql).search(query);
    expect(after.cache.hit).toBe(false);
    expect(after.total).toBe(1);
    expect(after.results).toHaveLength(1);
    expect(after.results[0]!.best_offer.price).toBe(200);
  });

  it('con la caché caliente, al caducar la mejor oferta el producto sigue con la otra', async () => {
    await upsertCatalog(client.db, [
      {
        category: { name: 'Gadgets' },
        brand: 'Comun',
        canonicalName: 'Quixelor Uno',
        modelNumber: 'QX-1',
        variants: [{ key: 'qx', gtin: null, attributes: {} }],
      },
    ]);
    // La más barata caduca (> 72 h) en 1,5 s; la otra está recién vista.
    await client.sql`
      insert into offers (merchant_id, external_id, title_raw, url, price, availability, variant_id, match_status, last_seen_at)
      select m.id, x.ext, 'Quixelor Uno', 'https://t.example/p/' || x.ext, x.price, 'in_stock', v.id, 'manual', x.seen
        from (values ('tienda-grande', 'QX-A', 100, now() - interval '72 hours' + interval '1.5 seconds'),
                     ('tienda-unica',  'QX-B', 200, now())) as x(merchant, ext, price, seen)
        join merchants m on m.slug = x.merchant
        cross join (select pv.id from product_variants pv join products p on p.id = pv.product_id
                     where p.model_number = 'QX-1') v`;

    const before = await get('/api/search?q=quixelor');
    expect(before.cache.hit).toBe(false);
    expect(before.results[0].best_offer.price).toBe(100);

    await new Promise((r) => setTimeout(r, 2000));

    // Misma versión de catálogo y la entrada sigue en el store: no debe servirse.
    expect(data.size).toBeGreaterThan(0);
    const after = await get('/api/search?q=quixelor');
    expect(after.cache.hit).toBe(false);
    expect(after.total).toBe(1);
    expect(after.results).toHaveLength(1);
    expect(after.results[0].best_offer.price).toBe(200);
    expect(after.results[0].min_price).toBe(200);
  });
});
