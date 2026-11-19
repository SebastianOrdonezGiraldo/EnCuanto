import { merchants, offers, priceHistory, quarantinedRecords } from '@encuanto/db';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSyntheticFeeds } from '../../src/dev/synthetic';
import {
  listSyncRuns,
  retryPendingInvalidation,
  runSync,
  SyncFailedError,
  type SyncDeps,
} from '../../src/modules/ingestion/index';
import { CsvFeedAdapter, FeedSource } from '../../src/modules/providers/index';
import { upsertMerchant } from '../../src/modules/merchants/index';
import { silentLog } from '../../src/shared/log';
import { DATABASE_URL, fakeAdapter, offer, setupDb, type TestDb } from './helpers';

// Integración con PostgreSQL real: criterios de aceptación de H1.
describe.skipIf(!DATABASE_URL)('ingesta: seed sintético e idempotencia (H1)', () => {
  let ctx: TestDb;
  let deps: SyncDeps;
  let slugs: string[];
  let expectedValid: number;
  let catalogChanges = 0;

  const counts = async () => {
    const ids = (
      await ctx.client.db
        .select({ id: merchants.id })
        .from(merchants)
        .where(inArray(merchants.slug, slugs))
    ).map((r) => r.id);
    const [o] = await ctx.client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(offers)
      .where(inArray(offers.merchantId, ids));
    const [h] = await ctx.client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(priceHistory)
      .innerJoin(offers, eq(offers.id, priceHistory.offerId))
      .where(inArray(offers.merchantId, ids));
    const q = await ctx.client.db
      .select({ occurrences: quarantinedRecords.occurrences })
      .from(quarantinedRecords)
      .where(inArray(quarantinedRecords.merchantId, ids));
    return { offers: o!.n, history: h!.n, quarantine: q };
  };

  const syncAll = async () => {
    const results = [];
    for (const slug of slugs) results.push(await runSync(deps, slug, { trigger: 'test' }));
    return results;
  };

  const generate = async (day: number) => {
    const feeds = writeSyntheticFeeds({
      outDir: path.join(ctx.fixturesDir, 'generado'),
      day,
      slugPrefix: ctx.prefix,
    });
    for (const m of feeds.merchants) await upsertMerchant(ctx.client.db, m);
    return feeds;
  };

  beforeAll(async () => {
    ctx = await setupDb('seed');
    deps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      onCatalogChanged: async () => void catalogChanges++,
    };
    const feeds = await generate(0);
    slugs = feeds.merchants.map((m) => m.slug);
    expectedValid = feeds.validOffers;
  });

  afterAll(async () => ctx?.teardown());

  it('el seed crea 3 comerciantes y ≥ 2.000 ofertas, con historial inicial y cuarentena', async () => {
    const results = await syncAll();
    expect(results.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const c = await counts();
    expect(c.offers).toBeGreaterThanOrEqual(2000);
    expect(c.offers).toBe(expectedValid);
    expect(c.history).toBe(c.offers); // una fila por oferta nueva
    expect(c.quarantine).toHaveLength(12); // 4 inválidas por comerciante
    expect(catalogChanges).toBe(3);
  });

  it('reejecutar el sync es idempotente: sin ofertas, historial ni cuarentena nuevos', async () => {
    const before = await counts();
    const results = await syncAll();
    for (const r of results) {
      expect(r).toMatchObject({ status: 'succeeded', itemsInserted: 0, itemsPriceChanged: 0 });
    }
    const after = await counts();
    expect(after.offers).toBe(before.offers);
    expect(after.history).toBe(before.history);
    expect(after.quarantine).toHaveLength(12);
    expect(after.quarantine.every((q) => q.occurrences === 2)).toBe(true);
    expect(catalogChanges).toBe(3); // sin cambios no se invalida la caché
  });

  it('un día después: historial solo para los precios que cambiaron', async () => {
    const before = await counts();
    await generate(1);
    const results = await syncAll();
    const changed = results.reduce((sum, r) => sum + r.itemsPriceChanged, 0);
    expect(changed).toBeGreaterThan(0);
    const after = await counts();
    expect(after.offers).toBe(before.offers);
    expect(after.history).toBe(before.history + changed);

    // last_changed_at solo se mueve en las ofertas cuyo precio cambió.
    const [moved] = await ctx.client.db
      .select({ n: sql<number>`count(*)::int` })
      .from(offers)
      .innerJoin(merchants, eq(merchants.id, offers.merchantId))
      .where(
        and(
          like(merchants.slug, `${ctx.prefix}%`),
          sql`${offers.lastChangedAt} > ${offers.firstSeenAt}`,
        ),
      );
    expect(moved!.n).toBe(changed);
  });
});

describe.skipIf(!DATABASE_URL)('ingesta: operación de las fuentes (§9)', () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await setupDb('ops');
  });
  afterAll(async () => ctx?.teardown());

  const merchant = async (name: string) => {
    const slug = `${ctx.prefix}${name}`;
    await upsertMerchant(ctx.client.db, {
      slug,
      name,
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });
    return slug;
  };

  it('dos syncs a la vez del mismo comerciante: uno se omite por el lock', async () => {
    const slug = await merchant('lock');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) =>
        fakeAdapter(s, async function* () {
          await gate;
          yield offer('1', 100000);
        }),
    };
    const first = runSync(deps, slug);
    await new Promise((r) => setTimeout(r, 200));
    const second = await runSync(deps, slug);
    release();
    expect(second).toMatchObject({ status: 'skipped', summary: { skipped_reason: 'locked' } });
    expect((await first).status).toBe('succeeded');
  });

  it('external_id repetido en lotes distintos: vale el primero y el sync sigue idempotente', async () => {
    const slug = await merchant('dup');
    // 600 registros: el duplicado cae en otro lote de 500, con otro precio.
    const records = [
      offer('A', 100000),
      ...Array.from({ length: 598 }, (_, i) => offer(`R${i}`, 50000)),
      offer('A', 90000),
    ];
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) => fakeAdapter(s, () => records),
    };
    const first = await runSync(deps, slug);
    expect(first).toMatchObject({
      status: 'succeeded',
      itemsSeen: 600,
      itemsInserted: 599,
      itemsQuarantined: 1,
      summary: { quarantine_reasons: { duplicate_external_id: 1 } },
    });
    const second = await runSync(deps, slug);
    expect(second).toMatchObject({ itemsInserted: 0, itemsPriceChanged: 0 });
    const rows = await ctx.client.db
      .select({ price: offers.price })
      .from(offers)
      .innerJoin(merchants, eq(merchants.id, offers.merchantId))
      .where(and(eq(merchants.slug, slug), eq(offers.externalId, 'A')));
    expect(rows).toEqual([{ price: 100000 }]);
  });

  it('cuarentena: occurrences cuenta ejecuciones, no apariciones dentro de una', async () => {
    const slug = await merchant('cuarentena');
    const bad = { externalId: 'X', title: 'sin url', price: 1000 };
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) => fakeAdapter(s, () => [bad, ...Array.from({ length: 600 }, () => bad)]),
    };
    expect((await runSync(deps, slug)).itemsQuarantined).toBe(601);
    await runSync(deps, slug);
    const rows = await ctx.client.db
      .select({ occurrences: quarantinedRecords.occurrences })
      .from(quarantinedRecords)
      .innerJoin(merchants, eq(merchants.id, quarantinedRecords.merchantId))
      .where(eq(merchants.slug, slug));
    expect(rows).toEqual([{ occurrences: 2 }]);
  });

  it('si Redis falla al invalidar la caché: el sync no falla y la invalidación queda pendiente', async () => {
    const slug = await merchant('cache');
    let redisDown = true;
    let invalidations = 0;
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      onCatalogChanged: async () => {
        if (redisDown) throw new Error('redis caído');
        invalidations++;
      },
      adapterFor: (s) => fakeAdapter(s, () => [offer('K1', 100000)]),
    };
    const first = await runSync(deps, slug);
    expect(first.status).toBe('succeeded');
    const [run] = await listSyncRuns(ctx.client.db, { merchantSlug: slug, limit: 1 });
    expect(run!.errorSummary.catalog_invalidation_pending).toBe(true);

    // Redis vuelve: el siguiente sync (sin cambios propios) recupera la invalidación pendiente.
    redisDown = false;
    const second = await runSync(deps, slug);
    expect(second).toMatchObject({ itemsInserted: 0, itemsPriceChanged: 0 });
    expect(invalidations).toBe(1);
    const [after] = await listSyncRuns(ctx.client.db, { merchantSlug: slug, limit: 2 });
    expect(after!.errorSummary.catalog_invalidation_pending).toBeUndefined();
    expect(await retryPendingInvalidation(deps)).toBe(false);
  });

  it('un sync que falla tras confirmar un lote invalida igualmente la caché', async () => {
    const slug = await merchant('parcial');
    let invalidations = 0;
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      onCatalogChanged: async () => void invalidations++,
      adapterFor: (s) =>
        fakeAdapter(s, function* () {
          for (let i = 0; i < 600; i++) yield offer(`P${i}`, 100000);
          throw new Error('fuente cortada');
        }),
    };
    await expect(runSync(deps, slug)).rejects.toBeInstanceOf(SyncFailedError);
    const [run] = await listSyncRuns(ctx.client.db, { merchantSlug: slug, limit: 1 });
    expect(run).toMatchObject({ status: 'failed', itemsUpserted: 500 });
    expect(invalidations).toBe(1);
  });

  it('un corte del stream CSV falla el sync de forma controlada y el siguiente funciona', async () => {
    const slug = await merchant('csv-cortado');
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('id,t,u,p\nX1,Uno,https://t.example/1,1000\n'),
            );
            setTimeout(() => controller.error(new Error('ECONNRESET')), 20);
          },
        }),
        { status: 200 },
      );
    const adapter = new CsvFeedAdapter(
      slug,
      'partner_feed',
      'https://feeds.example/f.csv',
      ',',
      { externalId: 'id', title: 't', url: 'u', price: 'p' },
      new FeedSource({
        fixturesDir: ctx.fixturesDir,
        fetch: async () => broken(),
        lookup: async () => ['93.184.215.14'],
      }),
    );
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: () => adapter,
    };
    await expect(runSync(deps, slug)).rejects.toBeInstanceOf(SyncFailedError);
    const ok = await runSync(
      { ...deps, adapterFor: (s) => fakeAdapter(s, () => [offer('X1', 1000)]) },
      slug,
    );
    expect(ok.status).toBe('succeeded');
  });

  it('el error de un parser no se guarda con los bytes del feed', async () => {
    const slug = await merchant('parser');
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) =>
        fakeAdapter(s, () => {
          JSON.parse('SECRET_TOKEN_123 no es json');
          return [];
        }),
    };
    const error = await runSync(deps, slug).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncFailedError);
    expect(String((error as Error).stack)).not.toContain('SECRET_TOKEN');
    expect((error as Error).cause).toBeUndefined();
    const [run] = await listSyncRuns(ctx.client.db, { merchantSlug: slug, limit: 1 });
    expect(run!.errorSummary.error).toBe('error al leer o procesar el feed (SyntaxError)');
    expect(JSON.stringify(run)).not.toContain('SECRET_TOKEN');
  });

  it('circuit breaker: tras 5 fallos seguidos se pausa', async () => {
    const slug = await merchant('circuit');
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) =>
        fakeAdapter(s, () => {
          throw new Error('fuente caída');
        }),
    };
    for (let i = 0; i < 5; i++) await expect(runSync(deps, slug)).rejects.toThrow(SyncFailedError);
    await expect(runSync(deps, slug)).resolves.toMatchObject({
      status: 'skipped',
      summary: { skipped_reason: 'circuit_open' },
    });
  });

  it('alerta si items_seen cae más de 50 % frente a la media', async () => {
    const slug = await merchant('drop');
    let n = 10;
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      adapterFor: (s) =>
        fakeAdapter(s, () => Array.from({ length: n }, (_, i) => offer(String(i), 100000))),
    };
    expect((await runSync(deps, slug)).summary.alerts).toBeUndefined();
    n = 4;
    const r = await runSync(deps, slug);
    expect(r.summary.alerts?.[0]).toMatch(/^items_seen_drop/);
  });

  it('un cambio sin precio (disponibilidad) también invalida la caché del catálogo', async () => {
    const slug = await merchant('contenido');
    let availability = 'in_stock';
    let changes = 0;
    const deps: SyncDeps = {
      db: ctx.client,
      fixturesDir: ctx.fixturesDir,
      log: silentLog,
      onCatalogChanged: async () => void changes++,
      adapterFor: (s) => fakeAdapter(s, () => [offer('C1', 100000, { availability })]),
    };
    await runSync(deps, slug);
    await runSync(deps, slug);
    expect(changes).toBe(1); // nada cambió en la segunda
    availability = 'out_of_stock';
    const r = await runSync(deps, slug);
    expect(r).toMatchObject({ itemsPriceChanged: 0, itemsContentChanged: 1 });
    expect(changes).toBe(2);
  });

  it('comerciante inactivo: se omite', async () => {
    const slug = await merchant('inactivo');
    await ctx.client.db.update(merchants).set({ active: false }).where(eq(merchants.slug, slug));
    const r = await runSync({ db: ctx.client, fixturesDir: ctx.fixturesDir, log: silentLog }, slug);
    expect(r).toMatchObject({ status: 'skipped', summary: { skipped_reason: 'inactive' } });
  });
});
