import { healthResponseSchema } from '@encuanto/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const ok = async () => {};
const fail = async () => {
  throw new Error('connection refused');
};

function appWith(pingDatabase: () => Promise<void>, pingRedis: () => Promise<void>) {
  return buildApp({
    health: { pingDatabase, pingRedis, version: '0.0.0', startedAt: Date.now(), timeoutMs: 100 },
  });
}

describe('GET /health', () => {
  it('responde 200 y ok cuando BD y Redis responden', async () => {
    const app = appWith(ok, ok);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('responde 503 y degraded cuando falla la BD', async () => {
    const app = appWith(fail, ok);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    const body = healthResponseSchema.parse(res.json());
    expect(body.checks.database).toMatchObject({ status: 'error', error: 'connection refused' });
    expect(body.checks.redis.status).toBe('ok');
  });

  it('marca error si una dependencia no responde a tiempo', async () => {
    const hang = () => new Promise<void>(() => {});
    const app = appWith(ok, hang);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.redis.error).toMatch(/sin respuesta/);
  });
});

describe('errores', () => {
  it('ruta desconocida usa el formato uniforme', async () => {
    const app = appWith(ok, ok);
    const res = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Ruta no encontrada' } });
  });
});
