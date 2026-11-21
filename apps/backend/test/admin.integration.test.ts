import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { runSync } from '../src/modules/ingestion/index';
import { upsertMerchant } from '../src/modules/merchants/index';
import { silentLog } from '../src/shared/log';
import { DATABASE_URL, fakeAdapter, offer, setupDb, type TestDb } from './ingestion/helpers';

const TOKEN = 'token-de-prueba-sintetico-0123456789abcdef';

describe.skipIf(!DATABASE_URL)('admin mínimo de sync runs', () => {
  let ctx: TestDb;
  let slug: string;
  const enqueueSync = vi.fn(async () => 'job-1');
  let app: ReturnType<typeof buildApp>;
  const auth = { authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    ctx = await setupDb('admin');
    slug = `${ctx.prefix}tienda`;
    await upsertMerchant(ctx.client.db, {
      slug,
      name: 'Tienda',
      sourceType: 'manual',
      providerConfig: { kind: 'fixture', location: 'fixture:no-se-usa.json' },
    });
    await runSync(
      {
        db: ctx.client,
        fixturesDir: ctx.fixturesDir,
        log: silentLog,
        adapterFor: (s) => fakeAdapter(s, () => [offer('1', 100000), { title: 'inválida' }]),
      },
      slug,
    );
    app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: Date.now(),
      },
      admin: { client: ctx.client, token: TOKEN, enqueueSync },
    });
  });

  afterAll(async () => {
    await app?.close();
    await ctx?.teardown();
  });

  it.each([[{}], [{ authorization: 'Bearer otro-token' }], [{ authorization: TOKEN }]])(
    'sin token válido responde 401: %j',
    async (headers) => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/sync-runs', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'unauthorized', message: 'Token de administración inválido' },
      });
    },
  );

  it('lista las ejecuciones de un comerciante', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/sync-runs?merchant=${slug}&limit=5`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().runs).toEqual([
      expect.objectContaining({
        merchant: slug,
        status: 'succeeded',
        items_seen: 2,
        items_upserted: 1,
        items_quarantined: 1,
      }),
    ]);
  });

  it('valida la query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/sync-runs?limit=999',
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('muestra el estado de las fuentes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/merchants', headers: auth });
    const mine = res.json().merchants.find((m: { slug: string }) => m.slug === slug);
    expect(mine).toMatchObject({ offers: 1, has_source: true, last_run: { status: 'succeeded' } });
  });

  it('lista la cuarentena con su motivo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/quarantine?merchant=${slug}`,
      headers: auth,
    });
    expect(res.json().records).toEqual([
      expect.objectContaining({ merchant: slug, reason: 'invalid:externalId,price,url' }),
    ]);
  });

  it('encola un sync manual (202) y responde 404 si el comerciante no existe', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: `/api/admin/merchants/${slug}/sync`,
      headers: auth,
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ merchant: slug, job_id: 'job-1' });
    expect(enqueueSync).toHaveBeenCalledWith(slug);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/admin/merchants/${ctx.prefix}no-existe/sync`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('admin sin ADMIN_TOKEN', () => {
  it('las rutas no existen', async () => {
    const app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 't',
        startedAt: 0,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/admin/sync-runs' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
