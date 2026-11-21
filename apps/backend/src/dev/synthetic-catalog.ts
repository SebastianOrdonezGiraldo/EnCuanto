import { offers, type Database } from '@encuanto/db';
import { eq } from 'drizzle-orm';
import { upsertCatalog, type CatalogEntryInput } from '../modules/catalog/index';
import { assignVariants, type VariantAssignment } from '../modules/matching/index';
import { extractAttributes, normalizeText } from '../modules/normalization/index';
import { syntheticVariantIndex, type SyntheticVariant } from './synthetic';

/**
 * Fichas del catálogo sintético (H2). El seed conoce de qué variante sale cada oferta, así que
 * crea categorías, productos y variantes y enlaza las ofertas sin pasar por el matching (H3).
 * Devuelve cuántas ofertas cambiaron de variante.
 */
export async function linkSyntheticCatalog(
  db: Database,
  catalog: readonly SyntheticVariant[],
  merchantIds: readonly string[],
): Promise<{ products: number; variants: number; linked: number }> {
  const entries = new Map<string, CatalogEntryInput>();
  for (const v of catalog) {
    let entry = entries.get(v.productKey);
    if (!entry) {
      entry = {
        category: { name: v.category },
        brand: v.brand,
        canonicalName: v.productName,
        modelNumber: v.model,
        variants: [],
      };
      entries.set(v.productKey, entry);
    }
    entry.variants.push({
      key: v.key,
      gtin: v.gtin,
      attributes: extractAttributes(normalizeText(v.label)).attributes,
    });
  }
  const variantIds = await upsertCatalog(db, [...entries.values()]);

  const assignments: VariantAssignment[] = [];
  for (const merchantId of merchantIds) {
    const rows = await db
      .select({ externalId: offers.externalId })
      .from(offers)
      .where(eq(offers.merchantId, merchantId));
    for (const { externalId } of rows) {
      const index = syntheticVariantIndex(externalId);
      const variant = index === null ? undefined : catalog[index];
      const variantId = variant && variantIds.get(variant.key);
      if (variantId) assignments.push({ merchantId, externalId, variantId });
    }
  }
  const linked = await assignVariants(db, assignments);
  return { products: entries.size, variants: variantIds.size, linked };
}

export interface SyntheticMatchingReport {
  /** Ofertas válidas de los feeds. */
  offers: number;
  /** Ofertas con ficha (enlazadas solas). */
  linked: number;
  /** Ofertas en la cola de revisión. */
  inReview: number;
  /**
   * Ofertas enlazadas cuya variante tiene como variante real mayoritaria la suya. Una variante
   * que mezcla dos variantes reales cuenta como error para las ofertas de la minoritaria.
   */
  correct: number;
  precision: number;
  /** Variantes reales repartidas en más de una ficha (duplicados: falta de cobertura). */
  splitVariants: number;
  /** Variantes reales con GTIN vendidas con ese GTIN en ≥ 2 tiendas. */
  sharedGtinVariants: number;
  /** De ellas, cuántas quedaron en una sola variante con todas sus ofertas (criterio de H3). */
  sharedGtinUnified: number;
}

/**
 * Evalúa el matching sobre el seed sintético: la variante real de cada oferta se conoce por su
 * `external_id` (`AUR-00042` es la variante 42 del catálogo maestro).
 */
export async function evaluateSyntheticMatching(
  db: Database,
  catalog: readonly SyntheticVariant[],
  merchantIds: readonly string[],
): Promise<SyntheticMatchingReport> {
  const rows: {
    externalId: string;
    variantId: string | null;
    gtin: string | null;
    pending: boolean;
  }[] = [];
  for (const merchantId of merchantIds) {
    const part = await db
      .select({
        externalId: offers.externalId,
        variantId: offers.variantId,
        gtin: offers.gtin,
        status: offers.matchStatus,
      })
      .from(offers)
      .where(eq(offers.merchantId, merchantId));
    for (const r of part) {
      if (syntheticVariantIndex(r.externalId) === null) continue;
      rows.push({ ...r, pending: r.status === 'pending' });
    }
  }
  const truth = (externalId: string) => catalog[syntheticVariantIndex(externalId)!]!.key;

  const byVariant = new Map<string, Map<string, number>>();
  const variantsOfTruth = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.variantId) continue;
    const t = truth(r.externalId);
    const counts = byVariant.get(r.variantId) ?? new Map<string, number>();
    counts.set(t, (counts.get(t) ?? 0) + 1);
    byVariant.set(r.variantId, counts);
    const set = variantsOfTruth.get(t) ?? new Set<string>();
    set.add(r.variantId);
    variantsOfTruth.set(t, set);
  }
  const majority = new Map(
    [...byVariant].map(([variantId, counts]) => [
      variantId,
      [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0],
    ]),
  );
  const linked = rows.filter((r) => r.variantId);
  const correct = linked.filter((r) => majority.get(r.variantId!) === truth(r.externalId)).length;

  // Mismo GTIN en ≥ 2 tiendas.
  const byGtin = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.gtin) continue;
    const list = byGtin.get(r.gtin) ?? [];
    list.push(r);
    byGtin.set(r.gtin, list);
  }
  const shared = [...byGtin.values()].filter((list) => list.length >= 2);
  const unified = shared.filter(
    (list) => list[0]!.variantId && list.every((r) => r.variantId === list[0]!.variantId),
  );

  return {
    offers: rows.length,
    linked: linked.length,
    inReview: rows.filter((r) => r.pending).length,
    correct,
    precision: linked.length === 0 ? 1 : correct / linked.length,
    splitVariants: [...variantsOfTruth.values()].filter((s) => s.size > 1).length,
    sharedGtinVariants: shared.length,
    sharedGtinUnified: unified.length,
  };
}
