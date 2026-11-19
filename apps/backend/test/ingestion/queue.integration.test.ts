import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bullConnection,
  createSyncQueue,
  createSyncWorker,
  enqueueSync,
  listSyncRuns,
  runSync,
  scheduleSyncs,
} from '../../src/modules/ingestion/index';
import { upsertMerchant } from '../../src/modules/merchants/index';
import { silentLog } from '../../src/shared/log';
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
  });
});
