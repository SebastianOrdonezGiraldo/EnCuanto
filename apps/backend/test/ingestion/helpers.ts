import { createDb, merchants, runMigrations, type DbClient } from '@encuanto/db';
import { like } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { upsertBrands } from '../../src/modules/catalog/index';
import type { ProviderAdapter } from '../../src/modules/providers/index';
import { SYNTHETIC_BRANDS } from '../../src/dev/synthetic';

export const DATABASE_URL = process.env.DATABASE_URL;
export const REDIS_URL = process.env.REDIS_URL;

export interface TestDb {
  client: DbClient;
  /** Prefijo de los slugs de este archivo de test. */
  prefix: string;
  fixturesDir: string;
  teardown(): Promise<void>;
}

/** BD de pruebas con prefijo único: los archivos de test corren en paralelo sin chocar. */
export async function setupDb(label: string): Promise<TestDb> {
  await runMigrations(DATABASE_URL!);
  const client: DbClient = createDb(DATABASE_URL!, { max: 4 });
  await upsertBrands(client.db, SYNTHETIC_BRANDS);
  const prefix = `t${Date.now().toString(36)}${label}-`;
  const fixturesDir = mkdtempSync(path.join(tmpdir(), 'encuanto-fixtures-'));
  return {
    client,
    prefix,
    fixturesDir,
    async teardown() {
      await client.db.delete(merchants).where(like(merchants.slug, `${prefix}%`));
      await client.close();
      rmSync(fixturesDir, { recursive: true, force: true });
    },
  };
}

/** Adaptador de prueba que entrega los registros dados (y opcionalmente espera o falla). */
export function fakeAdapter(
  merchantSlug: string,
  records: () => AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): ProviderAdapter {
  return {
    merchantSlug,
    sourceType: 'manual',
    limits: { rps: 1, burst: 1 },
    async *sync() {
      yield* records();
    },
    healthCheck: async () => ({ ok: true }),
  };
}

export const offer = (id: string, price: number, extra: Record<string, unknown> = {}) => ({
  externalId: id,
  title: `Celular Nubrix NX-${id} 128GB Negro`,
  url: `https://prueba.example/p/${id}`,
  price,
  ...extra,
});
