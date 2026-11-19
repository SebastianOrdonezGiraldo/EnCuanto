import { createDb } from '@encuanto/db';
import { Redis } from 'ioredis';
import pino from 'pino';
import {
  bullConnection,
  createSyncQueue,
  createSyncWorker,
  runSync,
  scheduleSyncs,
} from './modules/ingestion/index';
import { listSyncableMerchants } from './modules/merchants/index';
import { loadConfig } from './shared/config';
import { CATALOG_VERSION_KEY } from './shared/catalog-version';
import { resolveFixturesDir } from './shared/paths';

/**
 * Entrypoint de colas (§5): procesa la cola `provider-sync` con BullMQ y programa un sync
 * periódico por cada comerciante activo con fuente configurada.
 */
const config = loadConfig();
const log = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  base: { proc: 'worker' },
});
const db = createDb(config.DATABASE_URL, { max: config.WORKER_CONCURRENCY + 2 });
const connection = bullConnection(config.REDIS_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
const fixturesDir = resolveFixturesDir(config.FIXTURES_DIR);

const deps = {
  db,
  fixturesDir,
  log,
  // Sube la versión de catálogo: invalida la caché de búsqueda (§8.6, H2).
  onCatalogChanged: async () => void (await redis.incr(CATALOG_VERSION_KEY)),
};

const queue = createSyncQueue(connection);
const worker = createSyncWorker(
  connection,
  (job, signal) => runSync(deps, job.data.merchantSlug, { trigger: job.data.trigger, signal }),
  config.WORKER_CONCURRENCY,
);
worker.on('failed', (job, err) =>
  log.warn({ job_id: job?.id, merchant: job?.data.merchantSlug, err: err.message }, 'job falló'),
);
worker.on('error', (err) => log.error({ err: err.message }, 'worker: error'));

// Siempre se reconcilia: con SYNC_INTERVAL_MINUTES=0 se borran los schedulers que hubieran
// quedado en Redis de ejecuciones anteriores.
const slugs =
  config.SYNC_INTERVAL_MINUTES > 0 ? (await listSyncableMerchants(db.db)).map((m) => m.slug) : [];
await scheduleSyncs(queue, slugs, config.SYNC_INTERVAL_MINUTES * 60_000);
log.info({ merchants: slugs.length, every_min: config.SYNC_INTERVAL_MINUTES }, 'syncs programados');
log.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker listo');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'cerrando worker');
  await worker.close();
  await queue.close();
  await Promise.allSettled([db.close(), redis.quit()]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
