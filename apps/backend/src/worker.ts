import { createDb } from '@encuanto/db';
import { Redis } from 'ioredis';
import pino from 'pino';
import {
  bullConnection,
  createSyncQueue,
  createSyncWorker,
  logWorkerEvents,
  reconcileSchedules,
  runSync,
  startScheduleReconciler,
} from './modules/ingestion/index';
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
logWorkerEvents(worker, log);

// Se reconcilia al arrancar y cada SCHEDULE_RECONCILE_SECONDS: una fuente nueva o activada
// queda programada sin reiniciar, y con SYNC_INTERVAL_MINUTES=0 se borran los schedulers.
const reconciler = startScheduleReconciler(
  () => reconcileSchedules(db.db, queue, config.SYNC_INTERVAL_MINUTES),
  config.SCHEDULE_RECONCILE_SECONDS * 1000,
  log,
);
await reconciler.ready;
log.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker listo');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'cerrando worker');
  reconciler.stop();
  await worker.close();
  await queue.close();
  await Promise.allSettled([db.close(), redis.quit()]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
