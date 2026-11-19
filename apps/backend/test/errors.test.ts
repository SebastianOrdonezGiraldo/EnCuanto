import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { NotFoundError, RateLimitError, ValidationError } from '../src/shared/errors';

const deps = {
  health: {
    pingDatabase: async () => {},
    pingRedis: async () => {},
    version: 't',
    startedAt: Date.now(),
  },
};

describe('error handler', () => {
  it.each([
    [new NotFoundError('No existe'), 404, 'not_found'],
    [new ValidationError('Dato inválido', { field: 'q' }), 400, 'validation_error'],
    [new RateLimitError('Demasiadas peticiones'), 429, 'rate_limited'],
  ])('mapea %s', async (error, status, code) => {
    const app = buildApp(deps);
    app.get('/boom', async () => {
      throw error;
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toMatchObject({ code, message: error.message });
  });

  it('oculta el detalle de errores internos', async () => {
    const app = buildApp(deps);
    app.get('/boom', async () => {
      throw new Error('detalle interno con datos');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'Error interno' } });
  });
});
