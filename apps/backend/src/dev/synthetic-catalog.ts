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
