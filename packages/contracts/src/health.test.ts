import { describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from './index';

describe('healthResponseSchema', () => {
  it('acepta una respuesta sana', () => {
    const ok = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      uptime_s: 1,
      checks: {
        database: { status: 'ok', latency_ms: 2 },
        redis: { status: 'ok', latency_ms: 1 },
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rechaza un estado desconocido', () => {
    const bad = healthResponseSchema.safeParse({
      status: 'meh',
      version: '0.0.0',
      uptime_s: 1,
      checks: { database: { status: 'ok', latency_ms: 0 }, redis: { status: 'ok', latency_ms: 0 } },
    });
    expect(bad.success).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('exige code y message', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'x' } }).success).toBe(false);
    expect(errorResponseSchema.safeParse({ error: { code: 'x', message: 'y' } }).success).toBe(
      true,
    );
  });
});
