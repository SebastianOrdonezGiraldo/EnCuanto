import { createDb, type DbClient } from '@encuanto/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import {
  candidatesInMemory,
  decideMatch,
  findCandidates,
  prepareTitle,
  similarity,
} from '../../src/modules/matching/index';
import { normalizeText } from '../../src/modules/normalization/index';
import { loadDataset } from './dataset-db';
import { judge, metrics, toCandidates } from './evaluate';
import { ALL_OFFERS, CATALOG } from './set-de-prueba';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * El set de prueba se evalúa en memoria (precision.test.ts, también en Windows). Aquí se
 * comprueba que en la BD da lo mismo: la similitud de TypeScript es la de pg_trgm y la consulta
 * de candidatos lleva a las mismas decisiones que el catálogo en memoria.
 */
describe.skipIf(!DATABASE_URL)('matching: BD frente a memoria', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;
  let ids: Awaited<ReturnType<typeof loadDataset>>;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'matchcons');
    client = createDb(isolated.url, { max: 2 });
    ids = await loadDataset(client.db, CATALOG);
  });

  afterAll(async () => {
    await client?.close();
    await isolated?.drop();
  });

  it('similarity() de TypeScript es la de pg_trgm en todos los pares del set', async () => {
    const cores = ALL_OFFERS.map((o) => prepareTitle(o.title).core);
    const names = CATALOG.map((p) => p.name);
    const rows = await client.sql<{ core: string; name: string; s: number }[]>`
      select c.core, n.name, similarity(public.immutable_unaccent(lower(n.name)), c.core) as s
        from unnest(${cores}::text[]) as c(core), unnest(${names}::text[]) as n(name)`;
    expect(rows.length).toBe(cores.length * names.length);
    const diffs = rows.filter(
      (r) => Math.abs(similarity(r.core, normalizeText(r.name)) - Number(r.s)) > 1e-6,
    );
    expect(diffs).toEqual([]);
  });

  it('las decisiones con candidatos de la BD son las mismas que en memoria', async () => {
    const memory = toCandidates(CATALOG);
    const dbResults = [];
    for (const offer of ALL_OFFERS) {
      const input = { titleRaw: offer.title, gtin: offer.gtin, brand: offer.brand };
      const fromDb = await client.db.transaction(async (tx) =>
        decideMatch(input, await findCandidates(tx, input, prepareTitle(offer.title))),
      );
      const fromMemory = decideMatch(input, candidatesInMemory(memory, input));
      const a = judge(offer, fromDb, ids.variantKey, ids.productKey);
      const b = judge(offer, fromMemory);
      // Mismo tipo de decisión, mismo destino (traducido a claves del set) y mismo acierto. En
      // una revisión se compara la ficha candidata y el motivo: entre variantes igual de
      // posibles (variante ambigua) la candidata depende del orden de inserción.
      const productOf = (variantKey: string) =>
        CATALOG.find((p) => p.variants.some((v) => v.key === variantKey))?.key;
      const shape = (d: typeof fromDb, vk: (id: string) => string, pk: (id: string) => string) =>
        d.kind === 'auto'
          ? { kind: d.kind, level: d.level, target: vk(d.variantId) }
          : d.kind === 'review'
            ? { kind: d.kind, reason: d.reason, target: productOf(vk(d.variantId)) }
            : d.kind === 'new_variant'
              ? { kind: d.kind, target: pk(d.productId) }
              : { kind: d.kind };
      expect(shape(fromDb, ids.variantKey, ids.productKey), offer.title).toEqual(
        shape(
          fromMemory,
          (x) => x,
          (x) => x,
        ),
      );
      expect(a.correct).toBe(b.correct);
      dbResults.push(a);
    }
    expect(metrics(dbResults).precision).toBeGreaterThanOrEqual(0.95);
  });
});
