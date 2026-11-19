import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bullConnection,
  createSyncQueue,
  createSyncWorker,
  enqueueSync,
  listSyncRuns,
  logWorkerEvents,
  reconcileSchedules,
  runSync,
  scheduleSyncs,
} from '../../src/modules/ingestion/index';
import { upsertMerchant } from '../../src/modules/merchants/index';
import { silentLog, type Log } from '../../src/shared/log';
import { DATABASE_URL, fakeAdapter, offer, REDIS_URL, setupDb, type TestDb } from './helpers';

// BullMQ con Redis real y un prefijo propio, para no tocar la cola de desarrollo.
describe.skipIf(!DATABASE_URL || !REDIS_URL)('cola de sync con BullMQ', () => {
  const prefix = `test-${randomUUID()}`;
  const connection = bullConnection(REDIS_URL!);
  const queue = createSyncQueue(connection, prefix);
  let ctx: TestDb;
  let slug: string;

  beforeAll(async () => {
    ctx = await setupDb('queue');
    slug = `${ctx.prefix}cola`;
    await upsertMerchant(ctx.client.db, {
      slug,
      name: 'Cola',
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await ctx?.teardown();
  });

  it('el worker procesa un sync encolado y queda en provider_sync_runs', async () => {
    const worker = createSyncWorker(
      connection,
      (job, signal) =>
        runSync(
          {
            db: ctx.client,
            fixturesDir: ctx.fixturesDir,
            log: silentLog,
            adapterFor: (s) => fakeAdapter(s, () => [offer('Q1', 150000)]),
          },
          job.data.merchantSlug,
          { trigger: job.data.trigger, signal },
        ),
      1,
      prefix,
    );
    const done = new Promise((resolve, reject) => {
      worker.on('completed', resolve);
      worker.on('failed', (_job, err) => reject(err));
    });
    const jobId = await enqueueSync(queue, slug, 'admin');
    expect(jobId).toBeTruthy();
    await done;
    await worker.close();

    const [run] = await listSyncRuns(ctx.client.db, { merchantSlug: slug, limit: 1 });
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'admin', itemsUpserted: 1 });
  });

  it('encolar dos veces mientras hay uno pendiente no duplica el job', async () => {
    const a = await enqueueSync(queue, slug, 'admin');
    const b = await enqueueSync(queue, slug, 'admin');
    expect(b).toBe(a);
  });

  it('programa un sync periódico por comerciante y quita los que sobran', async () => {
    await scheduleSyncs(queue, [slug, `${ctx.prefix}otro`], 60_000);
    expect((await queue.getJobSchedulers()).map((s) => s.key).sort()).toEqual(
      [`schedule-${ctx.prefix}otro`, `schedule-${slug}`].sort(),
    );
    await scheduleSyncs(queue, [slug], 60_000);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual([`schedule-${slug}`]);

    // SYNC_INTERVAL_MINUTES=0: se borran los que quedaron de antes.
    await scheduleSyncs(queue, [slug], 0);
    expect(await queue.getJobSchedulers()).toEqual([]);
  });

  it('un feed malformado falla el job sin filtrar sus bytes y el worker sigue procesando', async () => {
    const TOKEN = 'T0K3N_SINTETICO';
    writeFileSync(path.join(ctx.fixturesDir, 'malo.json'), `{"offers": [${TOKEN} sin comillas`);
    const malo = `${ctx.prefix}malo`;
    const bueno = `${ctx.prefix}bueno`;
    await upsertMerchant(ctx.client.db, {
      slug: malo,
      name: 'Malo',
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:malo.json' },
    });
    await upsertMerchant(ctx.client.db, {
      slug: bueno,
      name: 'Bueno',
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });

    // Todo lo que llega a los logs (de runSync y de los listeners del worker), serializado.
    const lines: string[] = [];
    const capture = (obj: object, msg?: string) => void lines.push(JSON.stringify({ obj, msg }));
    const log: Log = { info: capture, warn: capture, error: capture };

    const worker = createSyncWorker(
      connection,
      (job, signal) =>
        runSync(
          {
            db: ctx.client,
            fixturesDir: ctx.fixturesDir,
            log,
            // El comercio malo usa el adaptador real de fixtures (parser JSON de verdad).
            ...(job.data.merchantSlug === bueno
              ? { adapterFor: (s: string) => fakeAdapter(s, () => [offer('B1', 99000)]) }
              : {}),
          },
          job.data.merchantSlug,
          { trigger: job.data.trigger, signal },
        ),
      1,
      prefix,
    );
    logWorkerEvents(worker, log);
    // Espera exactamente estos dos jobs (puede quedar otro pendiente de un test anterior).
    const ids = new Set<string>();
    const settledIds = new Set<string>();
    let release!: () => void;
    const both = new Promise<void>((resolve) => (release = resolve));
    const settle = (id?: string) => {
      if (id) settledIds.add(id);
      if (ids.size === 2 && [...ids].every((i) => settledIds.has(i))) release();
    };
    worker.on('completed', (job) => settle(job.id));
    worker.on('failed', (job) => settle(job?.id));
    const failedId = (await enqueueSync(queue, malo, 'admin'))!;
    const okId = (await enqueueSync(queue, bueno, 'admin'))!;
    ids.add(failedId).add(okId);
    settle();
    await both;
    await worker.close();

    const failed = await queue.getJob(failedId);
    expect(await failed!.getState()).toBe('failed');
    expect(failed!.failedReason).toBe('error al leer o procesar el feed (SyntaxError)');
    const ok = await queue.getJob(okId);
    expect(await ok!.getState()).toBe('completed');

    const [run] = await listSyncRuns(ctx.client.db, { merchantSlug: malo, limit: 1 });
    expect(run!.status).toBe('failed');
    expect(lines.some((l) => l.includes('job falló'))).toBe(true);
    const everything = JSON.stringify({
      lines,
      failedReason: failed!.failedReason,
      stacktrace: failed!.stacktrace,
      run,
    });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('sin comillas');
  });

  it('reconcilia schedulers: un comercio creado después queda programado sin reiniciar', async () => {
    const tarde = `${ctx.prefix}tarde`;
    expect(await reconcileSchedules(ctx.client.db, queue, 1)).not.toContain(tarde);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain(`schedule-${tarde}`);

    await upsertMerchant(ctx.client.db, {
      slug: tarde,
      name: 'Tarde',
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });
    expect(await reconcileSchedules(ctx.client.db, queue, 1)).toContain(tarde);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toContain(`schedule-${tarde}`);

    // Intervalo 0: no queda ningún scheduler.
    expect(await reconcileSchedules(ctx.client.db, queue, 0)).toEqual([]);
    expect(await queue.getJobSchedulers()).toEqual([]);
  });
});
