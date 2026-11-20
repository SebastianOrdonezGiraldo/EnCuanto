import { searchResponseSchema } from '@encuanto/contracts';
import { createDb, offers, outboundClicks, searchQueries, type DbClient } from '@encuanto/db';
import { eq, sql } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { seedSynthetic } from '../../src/dev/seed-synthetic';
import { upsertCatalog } from '../../src/modules/catalog/index';
import { assignVariants } from '../../src/modules/matching/index';
import { ListingCache, SearchService, type CacheStore } from '../../src/modules/search/index';
import { CATALOG_VERSION_KEY } from '../../src/shared/catalog-version';
import { loggerOptions } from '../../src/shared/logger';

const DATABASE_URL = process.env.DATABASE_URL;

/** Redis en memoria con la interfaz que usa la caché (get/set con EX). */
function memoryStore() {
  const data = new Map<string, string>();
  const store: CacheStore & { incr(k: string): void } = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    incr: (k) => void data.set(k, String(Number(data.get(k) ?? '0') + 1)),
  };
  return { store, data };
}

// Integración con PostgreSQL real en una BD aislada: la búsqueda ve todo el catálogo, así que
// los resultados exactos no pueden depender de lo que crean otros archivos de test.
describe.skipIf(!DATABASE_URL)('búsqueda y /go (H2)', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let fixturesDir: string;
  let app: ReturnType<typeof buildApp>;
  const logLines: string[] = [];
  const { store, data } = memoryStore();

  const search = async (qs: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/search?${qs}` });
    return { res, body: res.json() };
  };

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'search');
    client = createDb(isolated.url, { max: 4 });
    fixturesDir = mkdtempSync(path.join(tmpdir(), 'encuanto-search-'));
    await seedSynthetic(client, { fixturesDir, products: 64 });

    // Un accesorio para comprobar la penalización de §8.3.
    const merchantId = (
      await client.sql<{ id: string }[]>`select id from merchants where slug = 'tienda-aurora'`
    )[0]!.id;
    const variantIds = await upsertCatalog(client.db, [
      {
        category: { name: 'Fundas y cargadores', accessory: true },
        brand: 'Kalora',
        canonicalName: 'Funda para celular Kalora Nova',
        modelNumber: 'FU-1001',
        variants: [{ key: 'funda', gtin: null, attributes: {} }],
      },
    ]);
    await client.sql`
      insert into offers (merchant_id, external_id, title_raw, url, price, availability)
      values (${merchantId}, 'ACC-1', 'Funda para celular Kalora Nova', 'https://tienda-aurora.example/p/ACC-1', 19900, 'in_stock')`;
    await assignVariants(client.db, [
      { merchantId, externalId: 'ACC-1', variantId: variantIds.get('funda')! },
    ]);

    const log = { info() {}, warn() {}, error() {} };
    app = buildApp(
      {
        health: {
          pingDatabase: async () => {},
          pingRedis: async () => {},
          version: 't',
          startedAt: Date.now(),
        },
        search: new SearchService({
          client,
          cache: new ListingCache(store, 600, log),
          log,
          weights: { text: 1, trgm: 0.5 },
        }),
        outbound: { client },
      },
      {
        logger: loggerOptions(
          { NODE_ENV: 'production', LOG_LEVEL: 'info' },
          { stream: { write: (l: string) => void logLines.push(l) } },
        ),
      },
    );
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await isolated?.drop();
    if (fixturesDir) rmSync(fixturesDir, { recursive: true, force: true });
  });

  it('devuelve fichas agrupadas con "desde $X en N tiendas" y el contrato de §7', async () => {
    const { res, body } = await search('q=nevera%20no%20frost%20300%20litros');
    expect(res.statusCode).toBe(200);
    expect(searchResponseSchema.safeParse(body).success).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    expect(body.normalized.attributes).toEqual({ capacity_l: 300 });
    for (const r of body.results) {
      expect(r.name).toMatch(/^Nevera /);
      expect(r.min_price).toBe(r.best_offer.price);
      expect(r.max_price).toBeGreaterThanOrEqual(r.min_price);
      expect(r.offer_count).toBeGreaterThanOrEqual(r.merchant_count);
    }
    expect(body.results.some((r: { merchant_count: number }) => r.merchant_count > 1)).toBe(true);
  });

  it.each(['xqzw kjhv', 'asdfgh', 'zzzz yyyy wwww'])(
    'una consulta sin sentido devuelve vacío: %s',
    async (q) => {
      const { body } = await search(`q=${encodeURIComponent(q)}`);
      expect(body.total).toBe(0);
      expect(body.results).toEqual([]);
    },
  );

  it('encuentra sin tildes y por número de modelo', async () => {
    const { body } = await search('q=portatil');
    expect(body.total).toBeGreaterThan(0);
    expect(body.results[0].name).toMatch(/^Portátil /);

    const [p] = await client.sql<{ model_number: string; canonical_name: string }[]>`
      select model_number, canonical_name from products where model_number is not null limit 1`;
    const byModel = await search(`q=${encodeURIComponent(p!.model_number)}`);
    expect(byModel.body.results[0].name).toBe(p!.canonical_name);
  });

  it('penaliza los accesorios salvo que se busquen (§8.3)', async () => {
    const celular = await search('q=celular%20kalora%20nova&page_size=48');
    const names = celular.body.results.map((r: { name: string }) => r.name);
    const funda = names.indexOf('Funda para celular Kalora Nova');
    const firstPhone = names.findIndex((n: string) => n.startsWith('Celular'));
    expect(firstPhone).toBeGreaterThanOrEqual(0);
    if (funda >= 0) expect(funda).toBeGreaterThan(firstPhone);

    const fundas = await search('q=funda%20celular');
    expect(fundas.body.results[0].name).toBe('Funda para celular Kalora Nova');
  });

  it('filtra por tienda, marca y precio, y ordena por precio', async () => {
    const all = await search('q=celular');
    const brand = all.body.facets.brands[0].name as string;
    const { body } = await search(
      `q=celular&merchants=tienda-aurora&brands=${encodeURIComponent(brand)}&max_price=3000000&sort=price_asc`,
    );
    expect(body.total).toBeGreaterThan(0);
    const prices = body.results.map((r: { min_price: number }) => r.min_price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    for (const r of body.results) {
      expect(r.brand).toBe(brand);
      expect(r.best_offer.merchant).toBe('tienda-aurora');
      expect(r.min_price).toBeLessThanOrEqual(3_000_000);
    }
    // Faceta de tiendas disyuntiva: con la tienda marcada sigue mostrando las demás.
    expect(body.facets.merchants.map((m: { slug: string }) => m.slug).sort()).toEqual([
      'electro-pacifico',
      'mercado-colibri',
      'tienda-aurora',
    ]);
    const aurora = body.facets.merchants.find((m: { slug: string }) => m.slug === 'tienda-aurora');
    expect(aurora.count).toBe(body.total);
  });

  it('pagina recortando el conjunto cacheado (§8.6) e invalida con la versión de catálogo', async () => {
    data.clear();
    const first = await search('q=televisor&page_size=5');
    expect(first.body.cache.hit).toBe(false);
    const second = await search('q=televisor&page_size=5&page=2');
    expect(second.body.cache.hit).toBe(true);
    expect(second.body.total).toBe(first.body.total);
    const ids = (b: { results: { product_id: string }[] }) => b.results.map((r) => r.product_id);
    expect(ids(second.body)).not.toEqual(expect.arrayContaining(ids(first.body)));
    expect([...data.keys()].some((k) => k.startsWith('search:v0:'))).toBe(true);

    store.incr(CATALOG_VERSION_KEY);
    const third = await search('q=televisor&page_size=5');
    expect(third.body.cache.hit).toBe(false);
    expect([...data.keys()].some((k) => k.startsWith('search:v1:'))).toBe(true);
  });

  it('valida la query con el formato de error uniforme', async () => {
    for (const qs of [
      'q=a',
      'q=tv&page_size=100',
      'q=tv&sort=popular',
      'q=tv&min_price=9&max_price=1',
    ]) {
      const { res, body } = await search(qs);
      expect(res.statusCode).toBe(400);
      expect(body.error.code).toBe('validation_error');
    }
  });

  it('discount_only devuelve vacío hasta que exista la validación con historial (H5)', async () => {
    const { body } = await search('q=celular&discount_only=true');
    expect(body.total).toBe(0);
  });

  it('frescura (§8.5): 24–72 h marca "puede haber cambiado"; > 72 h oculta la oferta', async () => {
    data.clear();
    const { body } = await search('q=licuadora&page_size=1');
    const offerId = body.results[0].best_offer.offer_id as string;

    await client.db
      .update(offers)
      .set({ lastSeenAt: sql`now() - interval '30 hours'` })
      .where(eq(offers.id, offerId));
    data.clear();
    const stale = await search('q=licuadora&page_size=48');
    const staleOffer = stale.body.results.find(
      (r: { best_offer: { offer_id: string } }) => r.best_offer.offer_id === offerId,
    );
    expect(staleOffer?.best_offer.stale).toBe(true);

    await client.db
      .update(offers)
      .set({ lastSeenAt: sql`now() - interval '73 hours'` })
      .where(eq(offers.id, offerId));
    data.clear();
    const hidden = await search('q=licuadora&page_size=48');
    expect(JSON.stringify(hidden.body)).not.toContain(offerId);
    const go = await app.inject({ method: 'GET', url: `/go/${offerId}` });
    expect(go.statusCode).toBe(404);
  });

  it('/go/:offerId registra el clic y redirige con 302 a la tienda', async () => {
    const { body } = await search('q=tablet&page_size=1');
    const offerId = body.results[0].best_offer.offer_id as string;
    const res = await app.inject({ method: 'GET', url: `/go/${offerId}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/[a-z-]+\.example\/p\//);
    expect(res.headers['cache-control']).toBe('no-store');
    const clicks = await client.db
      .select()
      .from(outboundClicks)
      .where(eq(outboundClicks.offerId, offerId));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.sessionHash).toBeNull();

    for (const bad of ['no-es-uuid', '00000000-0000-4000-8000-000000000000']) {
      const r = await app.inject({ method: 'GET', url: `/go/${bad}` });
      expect(r.statusCode).toBe(404);
    }
  });

  it('aplica la plantilla de afiliado de la tienda', async () => {
    await client.sql`
      update merchants set affiliate_template = 'https://afiliado.example/r?u={url}'
       where slug = 'mercado-colibri'`;
    const { body } = await search('q=lavadora&merchants=mercado-colibri&page_size=1');
    const res = await app.inject({
      method: 'GET',
      url: `/go/${body.results[0].best_offer.offer_id}`,
    });
    expect(res.headers.location).toMatch(
      /^https:\/\/afiliado\.example\/r\?u=https%3A%2F%2Fmercado-colibri\.example/,
    );
  });

  it('listados de categoría y tienda, y 404 si no existen', async () => {
    const cats = (await app.inject({ method: 'GET', url: '/api/categories' })).json();
    expect(cats.categories.map((c: { slug: string }) => c.slug)).toEqual(
      expect.arrayContaining(['portatiles', 'audifonos', 'neveras']),
    );

    const cat = await app.inject({
      method: 'GET',
      url: '/api/categories/portatiles?sort=price_desc',
    });
    expect(cat.statusCode).toBe(200);
    const catBody = cat.json();
    expect(catBody.category).toEqual({ slug: 'portatiles', name: 'Portátiles' });
    expect(
      catBody.results.every(
        (r: { category: { slug: string } }) => r.category.slug === 'portatiles',
      ),
    ).toBe(true);

    const shop = await app.inject({
      method: 'GET',
      url: '/api/merchants/electro-pacifico?page_size=48',
    });
    const shopBody = shop.json();
    expect(shopBody.merchant.slug).toBe('electro-pacifico');
    expect(
      shopBody.results.every(
        (r: { best_offer: { merchant: string } }) => r.best_offer.merchant === 'electro-pacifico',
      ),
    ).toBe(true);

    for (const url of [
      '/api/categories/no-existe',
      '/api/merchants/no-existe',
      '/api/categories/..%2Fx',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('guarda la consulta en search_queries sin datos personales y no la escribe en los logs', async () => {
    const q = 'nevera para ana.gomez@correo.example 3105551234';
    await search(`q=${encodeURIComponent(q)}`);
    await new Promise((r) => setTimeout(r, 200));
    const rows = await client.db.select().from(searchQueries);
    const stored = rows.map((r) => r.qNormalized);
    expect(stored).toContain('nevera para [email] [numero]');
    expect(JSON.stringify(rows)).not.toContain('correo');
    expect(JSON.stringify(rows)).not.toContain('3105551234');

    const raw = logLines.join('');
    expect(raw).toContain('/api/search');
    for (const forbidden of ['correo', '3105551234', 'nevera', 'televisor']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
