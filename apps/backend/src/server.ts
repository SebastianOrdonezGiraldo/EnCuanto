import { createDb } from '@encuanto/db';
import { buildApp } from './app';
import { bullConnection, createSyncQueue, enqueueSync } from './modules/ingestion/index';
import { ListingCache, SearchService } from './modules/search/index';
import { loadConfig } from './shared/config';
import { loggerOptions } from './shared/logger';
import { createRedis } from './shared/redis';

const VERSION = process.env.npm_package_version ?? '0.0.0';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
// La cola solo hace falta para el sync manual del admin.
const syncQueue = config.ADMIN_TOKEN ? createSyncQueue(bullConnection(config.REDIS_URL)) : null;

// La caché es opcional: si Redis cae, la búsqueda sigue funcionando sin caché.
const searchLog = {
  info: (obj: object, msg?: string) => app.log.info(obj, msg),
  warn: (obj: object, msg?: string) => app.log.warn(obj, msg),
  error: (obj: object, msg?: string) => app.log.error(obj, msg),
};
const search = new SearchService({
  client: db,
  cache: new ListingCache(
    config.SEARCH_CACHE_TTL_SECONDS > 0 ? redis : null,
    config.SEARCH_CACHE_TTL_SECONDS,
    searchLog,
  ),
  log: searchLog,
  weights: { text: config.SEARCH_W_TEXT, trgm: config.SEARCH_W_TRGM },
});

const app = buildApp(
  {
    health: {
      pingDatabase: (signal) => db.ping(signal),
      pingRedis: async () => {
        if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
        await redis.ping();
      },
      version: VERSION,
      startedAt: Date.now(),
    },
    admin:
      config.ADMIN_TOKEN && syncQueue
        ? {
            db: db.db,
            token: config.ADMIN_TOKEN,
            enqueueSync: (slug) => enqueueSync(syncQueue, slug, 'admin'),
          }
        : undefined,
    search,
    outbound: { client: db },
  },
  { logger: loggerOptions(config) },
);

redis.on('error', (err) => app.log.warn({ err: err.message }, 'redis: error de conexión'));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  await app.close();
  await Promise.allSettled([db.close(), redis.quit(), syncQueue?.close()]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await redis
  .connect()
  .catch((err: Error) => app.log.warn({ err: err.message }, 'redis no disponible al arrancar'));
await app.listen({ host: config.HOST, port: config.PORT });
