import { productResponseSchema } from '@encuanto/contracts';
import { createDb, type DbClient } from '@encuanto/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { upsertCatalog } from '../../src/modules/catalog/index';
import { ListingCache, SearchService } from '../../src/modules/search/index';
import { silentLog } from '../../src/shared/log';

const DATABASE_URL = process.env.DATABASE_URL;

/** GET /api/products/:id (§7, H3): ficha con variantes y ofertas vigentes. */
describe.skipIf(!DATABASE_URL)('ficha de producto', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let app: ReturnType<typeof buildApp>;
  let productId: string;
  let emptyProductId: string;
  let ids: Map<string, string>;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'product');
    client = createDb(isolated.url, { max: 2 });
    await client.sql`
      insert into merchants (slug, name, source_type, active)
      values ('tienda-a', 'Tienda A', 'manual', true), ('tienda-b', 'Tienda B', 'manual', true),
             ('tienda-apagada', 'Tienda Apagada', 'manual', false)`;
    ids = await upsertCatalog(client.db, [
      {
        category: { name: 'Celulares' },
        brand: 'Kalora',
        canonicalName: 'Celular Kalora Nova 12',
        modelNumber: 'KA-N12',
        variants: [
          { key: '128', gtin: null, attributes: { storage_gb: 128, color: 'negro' } },
          { key: '256', gtin: null, attributes: { storage_gb: 256, color: 'negro' } },
          { key: '512', gtin: null, attributes: { storage_gb: 512, color: 'negro' } },
        ],
      },
      {
        category: { name: 'Celulares' },
        brand: 'Kalora',
        canonicalName: 'Celular Kalora Viejo',
        modelNumber: 'KA-OLD',
        variants: [{ key: 'old', gtin: null, attributes: {} }],
      },
    ]);
    const offer = async (
      id: string,
      merchant: string,
      variant: string,
      price: number,
      extra: { hoursAgo?: number; availability?: string; listPrice?: number } = {},
    ) => client.sql`
      insert into offers (merchant_id, external_id, title_raw, url, price, list_price, availability,
                          variant_id, match_status, last_seen_at)
      select m.id, ${id}, ${`Oferta ${id}`}, ${`https://${merchant}.example/p/${id}`}, ${price},
             ${extra.listPrice ?? null}, ${extra.availability ?? 'in_stock'}::offer_availability,
             ${ids.get(variant)!}, 'auto', now() - make_interval(hours => ${extra.hoursAgo ?? 1})
        from merchants m where m.slug = ${merchant}`;
    // 256 GB: la más barata está agotada; la segunda tiene descuento informado.
    await offer('A256', 'tienda-a', '256', 1_900_000, { availability: 'out_of_stock' });
    await offer('B256', 'tienda-b', '256', 2_000_000, { listPrice: 2_500_000 });
    // 128 GB: más barata; una oferta "puede haber cambiado" (30 h).
    await offer('A128', 'tienda-a', '128', 1_500_000, { hoursAgo: 30 });
    // Ofertas que no cuentan: caducada (> 72 h), de tienda inactiva.
    await offer('B128', 'tienda-b', '128', 900_000, { hoursAgo: 80 });
    await offer('X128', 'tienda-apagada', '128', 800_000);
    // 512 GB: solo una oferta caducada → la variante no aparece.
    await offer('A512', 'tienda-a', '512', 3_000_000, { hoursAgo: 100 });
    // El producto viejo solo tiene ofertas caducadas.
    await offer('AOLD', 'tienda-a', 'old', 100_000, { hoursAgo: 200 });
    const [p] = await client.sql<{ product_id: string }[]>`
      select product_id from product_variants where id = ${ids.get('128')!}`;
    productId = p!.product_id;
    const [q] = await client.sql<{ product_id: string }[]>`
      select product_id from product_variants where id = ${ids.get('old')!}`;
    emptyProductId = q!.product_id;

    const search = new SearchService({
      client,
      cache: new ListingCache(null, 0, silentLog),
      log: silentLog,
      weights: { text: 1, trgm: 0.5 },
      logQueries: false,
    });
    app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: 0,
      },
      search,
    });
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await isolated?.drop();
  });

  it('devuelve las variantes con ofertas vigentes, la de mejor precio primero', async () => {
    const res = await app.inject({ url: `/api/products/${productId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = productResponseSchema.parse(res.json());
    expect(body.product).toMatchObject({
      id: productId,
      name: 'Celular Kalora Nova 12',
      brand: 'Kalora',
      model_number: 'KA-N12',
      category: { slug: 'celulares', name: 'Celulares' },
    });
    expect(body.variants.map((v) => v.attributes.storage_gb)).toEqual([128, 256]);
    expect(body).toMatchObject({
      offer_count: 3,
      merchant_count: 2,
      min_price: 1_500_000,
      max_price: 2_000_000,
    });

    const [v128, v256] = body.variants;
    expect(v128!.offers.map((o) => o.merchant)).toEqual(['tienda-a']);
    expect(v128!.offers[0]).toMatchObject({ stale: true, in_stock: true });
    // La agotada va al final aunque sea más barata, y no cuenta para el precio mínimo.
    expect(v256!.offers.map((o) => o.offer_id.length > 0 && o.merchant)).toEqual([
      'tienda-b',
      'tienda-a',
    ]);
    expect(v256!.min_price).toBe(2_000_000);
    expect(v256!.offers[0]).toMatchObject({
      discount_pct: 20,
      discount_validated: false,
      list_price: 2_500_000,
    });
    expect(v256!.offers[1]).toMatchObject({ availability: 'out_of_stock', in_stock: false });
  });

  it('404 si no existe, si el id no es un uuid o si no tiene ofertas vigentes', async () => {
    for (const url of [
      '/api/products/00000000-0000-4000-8000-000000000000',
      '/api/products/no-es-un-uuid',
      `/api/products/${emptyProductId}`,
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
  });
});
