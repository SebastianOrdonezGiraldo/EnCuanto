import { createDb } from '@encuanto/db';
import { buildApp } from './app';
import { loadConfig } from './shared/config';
import { loggerOptions } from './shared/logger';
import { createRedis } from './shared/redis';

const VERSION = process.env.npm_package_version ?? '0.0.0';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

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
  },
  { logger: loggerOptions(config) },
);

redis.on('error', (err) => app.log.warn({ err: err.message }, 'redis: error de conexión'));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  await app.close();
  await Promise.allSettled([db.close(), redis.quit()]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await redis
  .connect()
  .catch((err: Error) => app.log.warn({ err: err.message }, 'redis no disponible al arrancar'));
await app.listen({ host: config.HOST, port: config.PORT });
