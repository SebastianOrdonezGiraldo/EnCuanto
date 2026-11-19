import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loggablePath, loggerOptions } from '../src/shared/logger';

/** Construye la app con la configuración de logs de producción y captura cada línea JSON. */
function appWithCapturedLogs() {
  const lines: string[] = [];
  const stream = { write: (line: string) => void lines.push(line) };
  const app = buildApp(
    {
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: Date.now(),
      },
    },
    { logger: loggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' }, { stream }) },
  );
  return { app, lines };
}

const EMAIL = 'persona@example.test';
const TOKEN = 'secreto_sintetico';
const IP = '203.0.113.77';
const FORGED_ID = `id-${EMAIL}`;

describe('logs de peticiones (§4.3, §13)', () => {
  it('no contienen query, cabeceras sensibles, IP ni un x-request-id del cliente', async () => {
    const { app, lines } = appWithCapturedLogs();
    const res = await app.inject({
      method: 'GET',
      url: `/health?email=${encodeURIComponent(EMAIL)}&token=${TOKEN}`,
      remoteAddress: IP,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        cookie: `session=${TOKEN}`,
        'x-request-id': FORGED_ID,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const raw = lines.join('');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const forbidden of [
      EMAIL,
      encodeURIComponent(EMAIL),
      TOKEN,
      IP,
      FORGED_ID,
      'remoteAddress',
      'remotePort',
    ]) {
      expect(raw).not.toContain(forbidden);
    }

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const incoming = entries.find((e) => e.msg === 'incoming request');
    const completed = entries.find((e) => e.msg === 'request completed');
    expect(incoming?.req).toEqual({ method: 'GET', url: '/health' });
    expect(completed?.res).toEqual({ statusCode: 200 });

    // Correlación: mismo request_id generado por el servidor en ambas líneas y en la respuesta.
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(incoming?.request_id).toBe(id);
    expect(completed?.request_id).toBe(id);
  });

  it('en rutas desconocidas registra el path sin query', async () => {
    const { app, lines } = appWithCapturedLogs();
    await app.inject({ method: 'GET', url: `/no-existe?email=${EMAIL}` });
    await app.close();
    const raw = lines.join('');
    expect(raw).not.toContain(EMAIL);
    expect(raw).toContain('"url":"/no-existe"');
  });
});

describe('loggablePath', () => {
  it('prefiere el patrón de la ruta', () => {
    expect(
      loggablePath({ url: '/go/123?x=1', routeOptions: { url: '/go/:offerId' } } as never),
    ).toBe('/go/:offerId');
  });

  it('quita query y fragmento si no hay patrón', () => {
    expect(loggablePath({ url: '/a/b?q=1#f', routeOptions: {} } as never)).toBe('/a/b');
  });
});
