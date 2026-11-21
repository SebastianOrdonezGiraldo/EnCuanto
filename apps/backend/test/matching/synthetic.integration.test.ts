import { createDb, type DbClient } from '@encuanto/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { seedSynthetic } from '../../src/dev/seed-synthetic';
import { evaluateSyntheticMatching } from '../../src/dev/synthetic-catalog';
import { runMatching } from '../../src/modules/matching/index';
import { silentLog } from '../../src/shared/log';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * El matching construye el catálogo desde cero con los feeds sintéticos de las 3 tiendas
 * (JSON, CSV en mayúsculas y Google Merchant con la marca delante; ~15 % de ofertas sin GTIN).
 * La variante real de cada oferta se conoce por su external_id.
 */
describe.skipIf(!DATABASE_URL)('matching sobre el seed sintético desde un catálogo vacío', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let fixturesDir: string;
  let seeded: Awaited<ReturnType<typeof seedSynthetic>>;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'matchsynth');
    client = createDb(isolated.url, { max: 4 });
    fixturesDir = mkdtempSync(path.join(tmpdir(), 'encuanto-matchsynth-'));
    seeded = await seedSynthetic(client, { fixturesDir, products: 120, link: 'matching' });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await isolated?.drop();
    if (fixturesDir) rmSync(fixturesDir, { recursive: true, force: true });
  });

  it('precisión ≥ 95 % y mismo GTIN en varias tiendas → una sola variante', async () => {
    const report = await evaluateSyntheticMatching(
      client.db,
      seeded.feeds.catalog,
      seeded.merchantIds,
    );
    process.stdout.write(
      `seed sintético con matching: ${JSON.stringify({ matching: seeded.matching, report })}\n`,
    );
    expect(seeded.matching!.failed).toBe(0);
    expect(report.offers).toBe(seeded.feeds.validOffers);
    expect(report.precision).toBeGreaterThanOrEqual(0.95);
    expect(report.sharedGtinVariants).toBeGreaterThan(100);
    expect(report.sharedGtinUnified).toBe(report.sharedGtinVariants);
  });

  it('reejecutar el seed y el matching es idempotente', async () => {
    const again = await seedSynthetic(client, { fixturesDir, products: 120, link: 'matching' });
    expect(again.matching!.processed).toBe(0);
    expect((await runMatching({ db: client, log: silentLog })).processed).toBe(0);
  });
});
