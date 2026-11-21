import { describe as group, expect, it } from 'vitest';
import { candidatesInMemory, decideMatch } from '../../src/modules/matching/index';
import { describe, judge, metrics, toCandidates } from './evaluate';
import { ALL_OFFERS, CATALOG, OFFERS } from './set-de-prueba';

const catalog = toCandidates(CATALOG);
const run = (offers = ALL_OFFERS, products = catalog) =>
  offers.map((offer) => {
    const input = { titleRaw: offer.title, gtin: offer.gtin, brand: offer.brand };
    return judge(offer, decideMatch(input, candidatesInMemory(products, input)));
  });

group('set de prueba del matching (criterio de H3)', () => {
  it('precisión ≥ 95 % en los enlaces automáticos', () => {
    const results = run();
    const m = metrics(results);
    // Resumen siempre; la tabla caso por caso con MATCHING_REPORT=1 (evidencia de la entrega).
    if (process.env.MATCHING_REPORT) process.stdout.write(`${describe(results)}\n`);
    process.stdout.write(`set de prueba del matching: ${JSON.stringify(m)}\n`);
    expect(m.cases).toBeGreaterThanOrEqual(150);
    expect(m.precision).toBeGreaterThanOrEqual(0.95);
  });

  it('ningún negativo ni ambiguo se enlaza solo', () => {
    const wrong = run().filter((r) => r.automatic && !r.correct);
    expect(wrong.map((r) => `${r.offer.title} (${r.offer.note})`)).toEqual([]);
  });

  it('sin la ficha "Pro", un "Nova 12 Pro" no se enlaza al "Nova 12"', () => {
    const offer = OFFERS.find((o) => o.title === 'Celular Kalora Nova 12 Pro 256GB 8GB Negro')!;
    const [r] = run(
      [offer],
      catalog.filter((p) => p.id !== 'nova12pro'),
    );
    expect(r!.automatic).toBe(false);
  });

  it('sin la ficha "A36", un "A36" no se enlaza al "A56"', () => {
    const offer = OFFERS.find((o) => o.title === 'Celular Nubrix Pulse A36 128GB 6GB Azul')!;
    const [r] = run(
      [offer],
      catalog.filter((p) => p.id !== 'a36'),
    );
    expect(r!.automatic).toBe(false);
  });
});
