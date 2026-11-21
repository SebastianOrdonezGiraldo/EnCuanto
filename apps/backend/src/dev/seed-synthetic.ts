import type { DbClient } from '@encuanto/db';
import path from 'node:path';
import { upsertBrands } from '../modules/catalog/index';
import { runSync, type SyncResult } from '../modules/ingestion/index';
import { runMatching } from '../modules/matching/index';
import { upsertMerchant } from '../modules/merchants/index';
import { silentLog } from '../shared/log';
import { SYNTHETIC_BRANDS, writeSyntheticFeeds } from './synthetic';
import { linkSyntheticCatalog } from './synthetic-catalog';

export interface SeedOptions {
  fixturesDir: string;
  day?: number;
  /** Productos del catálogo maestro: 420 da ~2.400 ofertas; ~8.750 da ~50.000 (benchmark). */
  products?: number;
  slugPrefix?: string;
  /**
   * Cómo se crean las fichas: `catalog` (por defecto) las crea desde el catálogo maestro, que
   * conoce la variante de cada oferta; `matching` deja que el matching de H3 las construya desde
   * un catálogo vacío, como pasaría con ofertas reales.
   */
  link?: 'catalog' | 'matching';
  onSync?: (result: SyncResult) => void;
}

/**
 * Seed sintético completo: feeds de 3 comerciantes ficticios, sync con la ingesta real (H1) y
 * fichas de producto enlazadas (H2) o construidas por el matching (H3). Idempotente con los mismos
 * parámetros.
 */
export async function seedSynthetic(client: DbClient, options: SeedOptions) {
  const { fixturesDir, day = 0, products, slugPrefix } = options;
  const feeds = writeSyntheticFeeds({
    outDir: path.join(fixturesDir, 'generado'),
    day,
    products,
    slugPrefix,
  });
  await upsertBrands(client.db, SYNTHETIC_BRANDS);
  const merchantIds: string[] = [];
  const syncs: SyncResult[] = [];
  for (const m of feeds.merchants) {
    const merchant = await upsertMerchant(client.db, { ...m, active: true });
    merchantIds.push(merchant.id);
    const r = await runSync({ db: client, fixturesDir, log: silentLog }, m.slug, {
      trigger: 'seed',
    });
    syncs.push(r);
    options.onSync?.(r);
  }
  if (options.link === 'matching') {
    const matching = await runMatching({ db: client, log: silentLog });
    return { feeds, syncs, merchantIds, catalog: null, matching };
  }
  const catalog = await linkSyntheticCatalog(client.db, feeds.catalog, merchantIds);
  return { feeds, syncs, merchantIds, catalog, matching: null };
}
