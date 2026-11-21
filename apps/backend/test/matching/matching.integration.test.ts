import {
  brands,
  categories,
  createDb,
  matchReviews,
  offers,
  products,
  productVariants,
  type DbClient,
} from '@encuanto/db';
import { eq, sql } from 'drizzle-orm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { runSync } from '../../src/modules/ingestion/index';
import { listReviews, resolveReview, runMatching } from '../../src/modules/matching/index';
import { upsertMerchant } from '../../src/modules/merchants/index';
import { ListingCache, SearchService } from '../../src/modules/search/index';
import { silentLog } from '../../src/shared/log';
import { fakeAdapter } from '../ingestion/helpers';
import { gtin } from './set-de-prueba';

const DATABASE_URL = process.env.DATABASE_URL;
const TOKEN = 'token-de-prueba-sintetico-0123456789abcdef';

type Feed = Record<string, unknown>[];

/**
 * Matching de extremo a extremo (H3): ingesta real → runMatching → fichas, búsqueda y cola de
 * revisión. BD aislada: el matching ve todo el catálogo, así que no puede compartirse con otros
 * archivos de test.
 */
describe.skipIf(!DATABASE_URL)('matching de extremo a extremo (H3)', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let fixturesDir: string;
  const feeds = new Map<string, Feed>();
  let bumps = 0;

  const offer = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    externalId: id,
    title,
    url: `https://prueba.example/p/${id}`,
    price: 1_499_900,
    availability: 'in_stock',
    ...extra,
  });

  const sync = async (slug: string, feed: Feed) => {
    feeds.set(slug, feed);
    return runSync(
      {
        db: client,
        fixturesDir,
        log: silentLog,
        adapterFor: (s) => fakeAdapter(s, () => feeds.get(s) ?? []),
      },
      slug,
    );
  };
  const match = () =>
    runMatching({ db: client, log: silentLog, onCatalogChanged: async () => void bumps++ });
  const offerRow = async (slug: string, externalId: string) => {
    const rows = await client.sql<
      {
        id: string;
        variant_id: string | null;
        product_id: string | null;
        match_status: string;
        match_level: number | null;
        match_confidence: number | null;
      }[]
    >`
      select o.id, o.variant_id, o.product_id, o.match_status, o.match_level, o.match_confidence
        from offers o join merchants m on m.id = o.merchant_id
       where m.slug = ${slug} and o.external_id = ${externalId}`;
    return rows[0]!;
  };
  const merchant = async (slug: string) =>
    upsertMerchant(client.db, {
      slug,
      name: `Tienda ${slug}`,
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'matching');
    client = createDb(isolated.url, { max: 6 });
    fixturesDir = mkdtempSync(path.join(tmpdir(), 'encuanto-matching-'));
    for (const slug of ['tienda-a', 'tienda-b', 'tienda-c', 'tienda-d']) await merchant(slug);
  });

  afterAll(async () => {
    await client?.close();
    await isolated?.drop();
    if (fixturesDir) rmSync(fixturesDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    bumps = 0;
  });

  it('mismo GTIN en 2 tiendas → 1 variante con 2 ofertas (criterio de H3)', async () => {
    const g = gtin(101);
    await sync('tienda-a', [
      offer('A1', 'Celular Kalora Nova 12 KA-N12 128GB 6GB RAM Negro', {
        gtin: g,
        brand: 'Kalora',
        category: 'Tecnología > Celulares',
        imageUrl: 'https://prueba.example/img/A1.jpg',
      }),
    ]);
    await sync('tienda-b', [
      offer('B1', 'KALORA CELULAR NOVA 12 128GB 6GB RAM NEGRO', { gtin: g, price: 1_399_900 }),
    ]);
    const result = await match();
    expect(result).toMatchObject({ processed: 2, newProducts: 1, failed: 0 });
    expect(result.auto.level1).toBe(1);
    expect(bumps).toBe(1);

    const a = await offerRow('tienda-a', 'A1');
    const b = await offerRow('tienda-b', 'B1');
    expect(a.variant_id).not.toBeNull();
    expect(b.variant_id).toBe(a.variant_id);
    expect(a).toMatchObject({ match_status: 'auto', match_level: 5, match_confidence: null });
    expect(b).toMatchObject({ match_status: 'auto', match_level: 1, match_confidence: 1 });
    // El trigger de H2 copia el producto de la variante.
    expect(b.product_id).toBe(a.product_id);

    const [product] = await client.db
      .select({
        name: products.canonicalName,
        model: products.modelNumber,
        brand: brands.name,
        category: categories.name,
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(eq(products.id, a.product_id!));
    expect(product).toEqual({
      name: 'Celular Kalora Nova 12',
      model: 'KA-N12',
      brand: 'Kalora',
      category: 'Celulares',
    });
    const [variant] = await client.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, a.variant_id!));
    expect(variant).toMatchObject({
      gtin: g,
      attributes: { storage_gb: 128, ram_gb: 6, color: 'negro' },
      imageUrl: 'https://prueba.example/img/A1.jpg',
    });
  });

  it('las ofertas emparejadas aparecen en la búsqueda (no vienen del seed)', async () => {
    const search = new SearchService({
      client,
      cache: new ListingCache(null, 0, silentLog),
      log: silentLog,
      weights: { text: 1, trgm: 0.5 },
      logQueries: false,
    });
    const res = await search.search({
      q: 'kalora nova 12',
      sort: 'price_asc',
      page: 1,
      page_size: 24,
      discount_only: false,
    });
    expect(res.total).toBe(1);
    expect(res.results[0]).toMatchObject({
      name: 'Celular Kalora Nova 12',
      offer_count: 2,
      merchant_count: 2,
      min_price: 1_399_900,
      best_offer: { merchant: 'tienda-b' },
    });
  });

  it('reejecutarlo sin cambios no hace nada', async () => {
    const result = await match();
    expect(result.processed).toBe(0);
    expect(bumps).toBe(0);
  });

  it('nivel 2: mismo modelo con otra capacidad crea una variante de la misma ficha y completa el GTIN', async () => {
    await sync('tienda-c', [
      offer('C1', 'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Azul', { brand: 'Kalora' }),
    ]);
    await match();
    const c1 = await offerRow('tienda-c', 'C1');
    const a = await offerRow('tienda-a', 'A1');
    expect(c1).toMatchObject({ match_status: 'auto', match_level: 2 });
    expect(c1.product_id).toBe(a.product_id);
    expect(c1.variant_id).not.toBe(a.variant_id);

    // Otra tienda trae la misma variante con GTIN: se enlaza por modelo y la variante lo gana.
    const g = gtin(102);
    await sync('tienda-d', [
      offer('D1', 'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Azul', { brand: 'Kalora', gtin: g }),
    ]);
    const result = await match();
    expect(result).toMatchObject({ processed: 1, gtinsFilled: 1 });
    const d1 = await offerRow('tienda-d', 'D1');
    expect(d1.variant_id).toBe(c1.variant_id);
    const [v] = await client.db
      .select({ gtin: productVariants.gtin })
      .from(productVariants)
      .where(eq(productVariants.id, c1.variant_id!));
    expect(v!.gtin).toBe(g);
  });

  it('nivel 4: similitud media va a la cola de revisión y la oferta no se muestra', async () => {
    await sync('tienda-c', [
      ...feeds.get('tienda-c')!,
      offer('C2', 'Kalora Nova 12 128GB 6GB Black - Envío gratis', { brand: 'Kalora' }),
    ]);
    const result = await match();
    expect(result).toMatchObject({ processed: 1, reviews: 1 });
    const c2 = await offerRow('tienda-c', 'C2');
    expect(c2).toMatchObject({ match_status: 'pending', variant_id: null });
    const [review] = await listReviews(client.db, { limit: 10 });
    expect(review).toMatchObject({
      status: 'pending',
      reason: 'similitud_media',
      offer: { id: c2.id, merchant: 'tienda-c' },
      candidate: { productName: 'Celular Kalora Nova 12' },
    });
    // Mientras espera, el matching no la vuelve a decidir.
    expect((await match()).processed).toBe(0);
  });

  it('aceptar la revisión enlaza la oferta como manual; la ingesta no la deshace', async () => {
    const [review] = await listReviews(client.db, { limit: 10 });
    const { variantId } = await resolveReview(client, review!.id, 'accept', async () => {
      bumps++;
    });
    expect(variantId).toBe(review!.candidate.variantId);
    expect(bumps).toBe(1);
    const c2 = await offerRow('tienda-c', 'C2');
    expect(c2).toMatchObject({ match_status: 'manual', variant_id: variantId });
    await expect(resolveReview(client, review!.id, 'discard')).rejects.toThrow(/ya está resuelta/);

    // Un cambio de título no reabre una decisión de una persona.
    await sync(
      'tienda-c',
      feeds
        .get('tienda-c')!
        .map((o) => (o.externalId === 'C2' ? { ...o, title: 'Kalora Nova 12 128GB Negro' } : o)),
    );
    expect(await offerRow('tienda-c', 'C2')).toMatchObject({ match_status: 'manual' });
  });

  it('si la fuente cambia título, GTIN o marca de una oferta automática, se vuelve a decidir', async () => {
    const before = await offerRow('tienda-b', 'B1');
    // Mismo external_id, ahora es otro producto (las tiendas reutilizan ids).
    await sync('tienda-b', [
      offer('B1', 'Licuadora Ondina Mix 600 1,5 L Roja OD-M600', {
        brand: 'Ondina',
        gtin: gtin(103),
      }),
    ]);
    expect(await offerRow('tienda-b', 'B1')).toMatchObject({
      match_status: 'pending',
      match_level: null,
      variant_id: before.variant_id,
    });
    // El precio u otros campos no la reabren.
    await sync('tienda-b', [
      offer('B1', 'Licuadora Ondina Mix 600 1,5 L Roja OD-M600', {
        brand: 'Ondina',
        gtin: gtin(103),
        price: 199_900,
      }),
    ]);
    const result = await match();
    expect(result).toMatchObject({ processed: 1, newProducts: 1 });
    const after = await offerRow('tienda-b', 'B1');
    expect(after.match_status).toBe('auto');
    expect(after.product_id).not.toBe(before.product_id);
    expect(bumps).toBe(1);
    // Con el precio cambiado ya no reabre nada.
    await sync('tienda-b', [
      offer('B1', 'Licuadora Ondina Mix 600 1,5 L Roja OD-M600', {
        brand: 'Ondina',
        gtin: gtin(103),
        price: 189_900,
      }),
    ]);
    expect((await offerRow('tienda-b', 'B1')).match_status).toBe('auto');
  });

  it('un cambio de datos descarta la revisión abierta de la oferta', async () => {
    await sync('tienda-d', [
      ...feeds.get('tienda-d')!,
      offer('D2', 'Kalora Nova 12 256GB 8GB Blue - Envío gratis', { brand: 'Kalora' }),
    ]);
    await match();
    const d2 = await offerRow('tienda-d', 'D2');
    const open = await client.db.select().from(matchReviews).where(eq(matchReviews.offerId, d2.id));
    expect(open).toHaveLength(1);
    await sync('tienda-d', [
      ...feeds.get('tienda-d')!.filter((o) => o.externalId !== 'D2'),
      offer('D2', 'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Azul', { brand: 'Kalora' }),
    ]);
    expect(
      await client.db.select().from(matchReviews).where(eq(matchReviews.offerId, d2.id)),
    ).toHaveLength(0);
    await match();
    expect(await offerRow('tienda-d', 'D2')).toMatchObject({
      match_status: 'auto',
      match_level: 2,
    });
  });

  it('dos matchings a la vez no crean dos fichas para el mismo producto', async () => {
    const g = gtin(104);
    const title = 'Nevera Austral Polar No Frost 360 Litros Gris AU-NF360';
    await sync('tienda-a', [
      ...feeds.get('tienda-a')!,
      offer('A2', title, { brand: 'Austral', gtin: g }),
    ]);
    await sync('tienda-c', [
      ...feeds.get('tienda-c')!,
      offer('C3', title, { brand: 'Austral', gtin: g }),
    ]);
    const [r1, r2] = await Promise.all([match(), match()]);
    expect(r1.processed + r2.processed + r1.skipped + r2.skipped).toBeGreaterThanOrEqual(2);
    expect(r1.newProducts + r2.newProducts).toBe(1);
    expect(r1.failed + r2.failed).toBe(0);
    const a2 = await offerRow('tienda-a', 'A2');
    const c3 = await offerRow('tienda-c', 'C3');
    expect(c3.variant_id).toBe(a2.variant_id);
    const [{ n }] =
      (await client.sql`select count(*)::int as n from product_variants where gtin = ${g}`) as unknown as [
        { n: number },
      ];
    expect(n).toBe(1);
  });

  it('decisiones de revisión: variante nueva, ficha nueva y descarte', async () => {
    // Tres ofertas dudosas de la misma ficha (similitud media).
    await sync('tienda-a', [
      ...feeds.get('tienda-a')!,
      offer('A3', 'Kalora Nova 12 512GB 8GB Black - Envío gratis', { brand: 'Kalora' }),
      offer('A4', 'Celular Kalora Nova 12 Lite 64GB', { brand: 'Kalora' }),
      offer('A5', 'Celular Kalora Nova 12 Exhibición 128GB 6GB Negro', { brand: 'Kalora' }),
    ]);
    await match();
    const pending = await listReviews(client.db, { limit: 10 });
    const byOffer = async (externalId: string) => {
      const row = await offerRow('tienda-a', externalId);
      return pending.find((r) => r.offer.id === row.id)!;
    };
    const a3 = await byOffer('A3');
    const a4 = await byOffer('A4');
    const a5 = await byOffer('A5');
    expect([a3, a4, a5].every(Boolean)).toBe(true);

    const nv = await resolveReview(client, a3.id, 'new_variant');
    const [variant] = await client.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, nv.variantId!));
    expect(variant!.productId).toBe(a3.candidate.productId);
    expect(variant!.attributes).toEqual({ storage_gb: 512, ram_gb: 8, color: 'negro' });

    const np = await resolveReview(client, a4.id, 'new_product');
    const [created] = await client.db
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, np.variantId!));
    expect(created!.productId).not.toBe(a4.candidate.productId);

    expect(await resolveReview(client, a5.id, 'discard')).toEqual({ variantId: null });
    expect(await offerRow('tienda-a', 'A5')).toMatchObject({
      match_status: 'rejected',
      variant_id: null,
    });
    expect(await offerRow('tienda-a', 'A3')).toMatchObject({ match_status: 'manual' });
    // Las descartadas no vuelven a decidirse mientras la fuente no las cambie.
    expect((await match()).processed).toBe(0);
  });

  it('gtin_conflicto: la variante o la ficha nuevas no reutilizan el GTIN de la candidata', async () => {
    // La tienda puso el GTIN de la licuadora Ondina a dos productos Kalora.
    const g = gtin(103);
    await sync('tienda-c', [
      ...feeds.get('tienda-c')!,
      offer('C4', 'Celular Kalora Nova 12 KA-N12 512GB Verde', { brand: 'Kalora', gtin: g }),
      offer('C5', 'Audífonos Kalora Beat 2', { brand: 'Kalora', gtin: g }),
    ]);
    await match();
    const pending = await listReviews(client.db, { limit: 50 });
    const reviewOf = async (externalId: string) => {
      const row = await offerRow('tienda-c', externalId);
      return pending.find((r) => r.offer.id === row.id)!;
    };
    const c4 = await reviewOf('C4');
    const c5 = await reviewOf('C5');
    expect(c4.reason).toBe('gtin_conflicto');
    expect(c5.reason).toBe('gtin_conflicto');

    const nv = await resolveReview(client, c4.id, 'new_variant');
    const np = await resolveReview(client, c5.id, 'new_product');
    const created = await client.db
      .select({ id: productVariants.id, gtin: productVariants.gtin })
      .from(productVariants)
      .where(sql`${productVariants.id} in (${nv.variantId!}, ${np.variantId!})`);
    expect(created).toHaveLength(2);
    expect(created.every((v) => v.gtin === null)).toBe(true);
    const [{ n }] =
      (await client.sql`select count(*)::int as n from product_variants where gtin = ${g}`) as unknown as [
        { n: number },
      ];
    expect(n).toBe(1);
  });

  it('resolver una revisión que un sync acaba de descartar no toca la oferta', async () => {
    await sync('tienda-b', [
      ...feeds.get('tienda-b')!,
      offer('B3', 'Kalora Nova 12 64GB 4GB Gold - Envío gratis', { brand: 'Kalora' }),
    ]);
    await match();
    const b3 = await offerRow('tienda-b', 'B3');
    const [review] = await client.db
      .select()
      .from(matchReviews)
      .where(eq(matchReviews.offerId, b3.id));
    expect(review?.status).toBe('pending');
    // El sync cambia el título: el trigger borra la revisión pendiente.
    await sync('tienda-b', [
      ...feeds.get('tienda-b')!.filter((o) => o.externalId !== 'B3'),
      offer('B3', 'Kalora Nova 12 64GB 4GB Dorado', { brand: 'Kalora' }),
    ]);
    // La revisión ya no existe: 404, y la oferta sigue pendiente para el matching.
    await expect(resolveReview(client, review!.id, 'accept')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await offerRow('tienda-b', 'B3')).match_status).toBe('pending');
    await match();
  });

  it('admin: lista la cola y aplica decisiones con validación', async () => {
    await sync('tienda-b', [
      ...feeds.get('tienda-b')!,
      offer('B2', 'Kalora Nova 12 128GB 6GB Gris - Envío gratis', { brand: 'Kalora' }),
    ]);
    await match();
    const app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: Date.now(),
      },
      admin: {
        client,
        token: TOKEN,
        enqueueSync: async () => 'job',
        enqueueMatching: async () => 'match-job',
        onCatalogChanged: async () => void bumps++,
      },
    });
    const auth = { authorization: `Bearer ${TOKEN}` };
    try {
      expect((await app.inject({ url: '/api/admin/match-reviews' })).statusCode).toBe(401);
      const list = await app.inject({ url: '/api/admin/match-reviews', headers: auth });
      expect(list.statusCode).toBe(200);
      expect(list.headers['cache-control']).toBe('no-store');
      const reviews = list.json().reviews as { id: string; offer: { title: string } }[];
      const review = reviews.find((r) => r.offer.title.includes('Gris'))!;
      expect(review).toBeDefined();

      const bad = await app.inject({
        method: 'POST',
        url: `/api/admin/match-reviews/${review.id}`,
        headers: auth,
        payload: { decision: 'borrar' },
      });
      expect(bad.statusCode).toBe(400);
      const notFound = await app.inject({
        method: 'POST',
        url: '/api/admin/match-reviews/no-es-un-uuid',
        headers: auth,
        payload: { decision: 'accept' },
      });
      expect(notFound.statusCode).toBe(404);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/admin/match-reviews/00000000-0000-4000-8000-000000000000',
        headers: auth,
        payload: { decision: 'accept' },
      });
      expect(missing.statusCode).toBe(404);

      const ok = await app.inject({
        method: 'POST',
        url: `/api/admin/match-reviews/${review.id}`,
        headers: auth,
        payload: { decision: 'new_variant' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ id: review.id, decision: 'new_variant' });
      expect(bumps).toBe(1);
      const again = await app.inject({
        method: 'POST',
        url: `/api/admin/match-reviews/${review.id}`,
        headers: auth,
        payload: { decision: 'accept' },
      });
      expect(again.statusCode).toBe(409);

      const enqueue = await app.inject({
        method: 'POST',
        url: '/api/admin/matching',
        headers: auth,
      });
      expect(enqueue.statusCode).toBe(202);
      expect(enqueue.json()).toEqual({ job_id: 'match-job' });

      const resolved = await app.inject({
        url: '/api/admin/match-reviews?status=rejected',
        headers: auth,
      });
      expect(resolved.json().reviews.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('migración 0005: los GTIN de las variantes quedan en 14 dígitos', async () => {
    const [{ n }] = (await client.sql`
      select count(*)::int as n from product_variants where gtin is not null and length(gtin) <> 14`) as unknown as [
      { n: number },
    ];
    expect(n).toBe(0);
    // upsertCatalog también normaliza: un GTIN-13 se guarda en 14 dígitos.
    const offersWithGtin = await client.db
      .select({ g: offers.gtin })
      .from(offers)
      .where(sql`${offers.gtin} is not null`);
    expect(offersWithGtin.every((o) => o.g!.length === 14)).toBe(true);
  });

  it('migración 0005: un UPC-12 y su EAN-13 con cero inicial no rompen la unicidad', async () => {
    // Se ejecuta la sentencia tal como está en la migración, sobre dos variantes que dan el mismo
    // GTIN de 14 dígitos, y se deshace.
    const migration = readFileSync(
      new URL('../../../../packages/db/migrations/0005_matching.sql', import.meta.url),
      'utf8',
    );
    const update = migration
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .find((part) => part.includes('UPDATE "product_variants"'))!;
    expect(update).toBeTruthy();
    const rows = await client.sql
      .begin(async (tx) => {
        const [p] =
          await tx`insert into products (canonical_name) values ('Prueba GTIN') returning id`;
        await tx`insert into product_variants (product_id, gtin, attributes) values
          (${p!.id}, '012345678905', '{}'), (${p!.id}, '0012345678905', '{"color":"negro"}')`;
        await tx.unsafe(update);
        const out =
          await tx`select gtin from product_variants where product_id = ${p!.id} order by gtin`;
        throw Object.assign(new Error('rollback'), { out });
      })
      .catch((error: { out?: { gtin: string }[] }) => {
        if (!error.out) throw error;
        return error.out;
      });
    // Una pasa a 14 dígitos (la primera por id) y la otra conserva su código original.
    const gtins = rows.map((r) => r.gtin);
    expect(gtins.filter((g) => g === '00012345678905')).toHaveLength(1);
    expect(gtins.filter((g) => g !== '00012345678905')).toEqual([
      expect.stringMatching(/^0?012345678905$/),
    ]);
  });
});
