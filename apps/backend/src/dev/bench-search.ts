import { createDb } from '@encuanto/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { buildApp } from '../app';
import { ListingCache, SearchService, type CacheStore } from '../modules/search/index';
import { silentLog } from '../shared/log';
import { createIsolatedDatabase } from './isolated-db';
import { seedSynthetic } from './seed-synthetic';

/**
 * Benchmark de H2: p95 de GET /api/search < 150 ms con 50.000 ofertas sintéticas.
 *
 *   pnpm bench:search                    # crea encuanto_bench, siembra ~50 k ofertas y mide
 *   pnpm bench:search --requests 1000
 *
 * Mide la petición completa (validación, SQL, ranking, facetas, hidratación y serialización)
 * con `inject`, sin red. El criterio se evalúa **sin caché** (peor caso: cada consulta va a la
 * BD); también se informa la latencia con caché. Sale con código 1 si no se cumple.
 */
const { values } = parseArgs({
  options: {
    requests: { type: 'string', default: '600' },
    products: { type: 'string', default: '8750' },
    keep: { type: 'boolean', default: false },
  },
});
const REQUESTS = Number(values.requests);
const TARGET_P95_MS = 150;

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  process.stderr.write('Falta DATABASE_URL\n');
  process.exit(1);
}
const out = (line: string) => process.stdout.write(`${line}\n`);

/** Consultas realistas (categoría, marca, modelo, atributos, errores, sin sentido) y filtros. */
const QUERIES = [
  'celular',
  'celular kalora',
  'celular 256gb',
  'nevera no frost 300 litros',
  'nevera',
  'televisor 55 pulgadas',
  'smart tv 4k',
  'portatil 16gb ram',
  'portátil nubrix air',
  'audifonos inalambricos',
  'audífonos negro',
  'licuadora',
  'lavadora 17 kg',
  'tablet 128gb',
  'kalora',
  'tecnova pulse',
  'vireo',
  'zenkai prime',
  'ka-4018s',
  'nu-1899p',
  'tv',
  'gb',
  'negro',
  'nebera',
  'portatl',
  'xqzw kjhv',
  'asdfgh',
  'funda celular',
  'lumbra cine',
  'ondina sonic',
];
const VARIANTS = [
  '',
  '&sort=price_asc',
  '&sort=price_desc',
  '&sort=discount',
  '&page=2',
  '&merchants=tienda-aurora',
  '&merchants=tienda-aurora,mercado-colibri&sort=price_asc',
  '&brands=Kalora,Nubrix',
  '&min_price=500000&max_price=3000000',
  '&page_size=48',
];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function memoryStore(): CacheStore {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
}

const isolated = await createIsolatedDatabase(baseUrl, 'bench', { name: 'encuanto_bench' });
const client = createDb(isolated.url, { max: 10 });
const fixturesDir = mkdtempSync(path.join(tmpdir(), 'encuanto-bench-'));
try {
  let t = performance.now();
  const seeded = await seedSynthetic(client, { fixturesDir, products: Number(values.products) });
  // Estado estable de una BD en uso: estadísticas al día y mapa de visibilidad (index-only
  // scans). Sin esto, el autovacuum de lo recién sembrado corre en medio de la medición.
  await client.sql`vacuum analyze`;
  const offers = seeded.syncs.reduce((n, r) => n + r.itemsUpserted, 0);
  out(
    `Catálogo: ${offers} ofertas, ${seeded.catalog?.products ?? 0} productos, ` +
      `${seeded.catalog?.variants ?? 0} variantes (${((performance.now() - t) / 1000).toFixed(1)} s)`,
  );

  const urls = Array.from({ length: REQUESTS }, (_, i) => {
    const q = QUERIES[i % QUERIES.length]!;
    const v = VARIANTS[Math.floor(i / QUERIES.length) % VARIANTS.length]!;
    return `/api/search?q=${encodeURIComponent(q)}${v}`;
  });

  const measure = async (label: string, cache: CacheStore | null) => {
    const app = buildApp({
      health: {
        pingDatabase: async () => {},
        pingRedis: async () => {},
        version: 'bench',
        startedAt: 0,
      },
      search: new SearchService({
        client,
        cache: new ListingCache(cache, 600, silentLog),
        log: silentLog,
        weights: { text: 1, trgm: 0.5 },
      }),
    });
    // Calentamiento: planes de consulta, JIT y pool de conexiones.
    for (const url of urls.slice(0, 30)) await app.inject({ method: 'GET', url });
    const times: number[] = [];
    const slow: { ms: number; url: string }[] = [];
    let empty = 0;
    let hits = 0;
    for (const url of urls) {
      t = performance.now();
      const res = await app.inject({ method: 'GET', url });
      const ms = performance.now() - t;
      times.push(ms);
      slow.push({ ms, url });
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} en ${url}`);
      const body = res.json();
      if (body.total === 0) empty++;
      if (body.cache.hit) hits++;
    }
    await app.close();
    times.sort((a, b) => a - b);
    const stats = {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: times.at(-1)!,
    };
    out(
      `${label.padEnd(10)} ${times.length} peticiones · p50 ${stats.p50.toFixed(1)} ms · ` +
        `p95 ${stats.p95.toFixed(1)} ms · p99 ${stats.p99.toFixed(1)} ms · máx ${stats.max.toFixed(1)} ms · ` +
        `vacías ${empty} · aciertos de caché ${hits}`,
    );
    slow.sort((a, b) => b.ms - a.ms);
    for (const s of slow.slice(0, 5)) out(`           ${s.ms.toFixed(1).padStart(6)} ms  ${s.url}`);
    return stats;
  };

  const cold = await measure('sin caché', null);
  await measure('con caché', memoryStore());
  const ok = offers >= 50_000 && cold.p95 < TARGET_P95_MS;
  out(
    ok
      ? `OK: p95 sin caché ${cold.p95.toFixed(1)} ms < ${TARGET_P95_MS} ms con ${offers} ofertas`
      : `NO CUMPLE: p95 ${cold.p95.toFixed(1)} ms (objetivo < ${TARGET_P95_MS} ms) con ${offers} ofertas`,
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await client.close();
  rmSync(fixturesDir, { recursive: true, force: true });
  if (!values.keep) await isolated.drop();
}
