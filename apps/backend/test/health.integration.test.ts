import { createDb } from '@encuanto/db';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createRedis } from '../src/shared/redis';

// Integración real contra PostgreSQL y Redis (docker compose o servicios del CI).
const { DATABASE_URL, REDIS_URL } = process.env;

describe.skipIf(!DATABASE_URL || !REDIS_URL)('GET /health con BD y Redis reales', () => {
  const db = createDb(DATABASE_URL!, { max: 1 });
  const redis = createRedis(REDIS_URL!);

  afterAll(async () => {
    await db.close();
    redis.disconnect();
  });

  it('responde ok', async () => {
    await redis.connect();
    const app = buildApp({
      health: {
        pingDatabase: (signal) => db.ping(signal),
        pingRedis: async () => void (await redis.ping()),
        version: 'test',
        startedAt: Date.now(),
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'ok' }, redis: { status: 'ok' } },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
