import { healthResponseSchema } from '@encuanto/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const ok = async () => {};
const fail = async () => {
  throw new Error('connection refused');
};

function appWith(
  pingDatabase: (signal: AbortSignal) => Promise<void>,
  pingRedis: (signal: AbortSignal) => Promise<void>,
) {
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

describe('sondas de /health', () => {
  it('aborta la sonda que vence el timeout', async () => {
    let aborted = false;
    const hang = (signal: AbortSignal) =>
      new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('cancelada'));
        });
      });
    const app = appWith(ok, hang);
    await app.inject({ method: 'GET', url: '/health' });
    expect(aborted).toBe(true);
  });

  it('las peticiones concurrentes comparten una sola sonda', async () => {
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
    };
    const app = appWith(slow, ok);
    await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/health' })));
    expect(calls).toBe(1);
  });
});

describe('loggerOptions', () => {
  it('no pide pino-pretty si no está instalado', async () => {
    const { loggerOptions } = await import('../src/shared/logger');
    const opts = loggerOptions(
      { NODE_ENV: 'development', LOG_LEVEL: 'info' },
      { isPrettyAvailable: () => false },
    );
    expect(opts).not.toHaveProperty('transport');
  });

  it('no usa pino-pretty en producción', async () => {
    const { loggerOptions } = await import('../src/shared/logger');
    expect(
      loggerOptions(
        { NODE_ENV: 'production', LOG_LEVEL: 'info' },
        { isPrettyAvailable: () => true },
      ),
    ).not.toHaveProperty('transport');
  });
});
