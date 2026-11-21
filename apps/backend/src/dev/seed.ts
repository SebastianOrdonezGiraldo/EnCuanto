import { createDb } from '@encuanto/db';
import { Redis } from 'ioredis';
import { parseArgs } from 'node:util';
import { countOffersByMerchant } from '../modules/ingestion/index';
import { CATALOG_VERSION_KEY } from '../shared/catalog-version';
import { loadConfig } from '../shared/config';
import { resolveFixturesDir } from '../shared/paths';
import { seedSynthetic } from './seed-synthetic';

/**
 * Seed sintético: genera los feeds de 3 comerciantes ficticios (≥ 2.000 ofertas), los
 * sincroniza con la misma ingesta que usa el worker (H1) y crea las fichas de producto que
 * la búsqueda necesita (H2; hasta H3 no hay matching que las cree).
 *
 *   pnpm db:seed              # día 0
 *   pnpm db:seed --day 3      # simula 3 días: ~12 % de precios cambia cada día
 *
 * Reejecutarlo con el mismo día no crea ofertas ni historial nuevos (idempotente).
 */
const { values } = parseArgs({ options: { day: { type: 'string', default: '0' } } });
const day = Number(values.day);
if (!Number.isInteger(day) || day < 0) {
  process.stderr.write('--day debe ser un entero ≥ 0\n');
  process.exit(1);
}

const config = loadConfig();
const fixturesDir = resolveFixturesDir(config.FIXTURES_DIR);
const client = createDb(config.DATABASE_URL, { max: 4 });
const out = (line: string) => process.stdout.write(`${line}\n`);

/** Invalida la caché de búsqueda (§8.6). Sin Redis no hay caché que invalidar: se avisa y sigue. */
async function bumpCatalogVersion(url: string): Promise<void> {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    await redis.connect();
    out(`Versión de catálogo: ${await redis.incr(CATALOG_VERSION_KEY)}`);
  } catch {
    out('Redis no disponible: la caché de búsqueda caducará sola (10 min)');
  } finally {
    redis.disconnect();
  }
}

try {
  const { feeds, catalog } = await seedSynthetic(client, {
    fixturesDir,
    day,
    onSync: (r) =>
      out(
        `${r.merchantSlug.padEnd(18)} ${r.status}  vistas ${r.itemsSeen}  nuevas ${r.itemsInserted}  ` +
          `cambios de precio ${r.itemsPriceChanged}  cuarentena ${r.itemsQuarantined}`,
      ),
  });
  out(
    `Feeds sintéticos del día ${day}: ${feeds.validOffers} ofertas válidas + ${feeds.invalidOffers} inválidas`,
  );
  const total = [...(await countOffersByMerchant(client.db)).values()].reduce((a, b) => a + b, 0);
  out(`Ofertas en la BD: ${total}`);
  out(
    `Fichas: ${catalog.products} productos, ${catalog.variants} variantes, ` +
      `${catalog.linked} ofertas enlazadas en esta ejecución`,
  );
  await bumpCatalogVersion(config.REDIS_URL);
} finally {
  await client.close();
}
