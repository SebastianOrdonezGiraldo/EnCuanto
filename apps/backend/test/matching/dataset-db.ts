import { productVariants, type Database } from '@encuanto/db';
import { inArray } from 'drizzle-orm';
import { upsertCatalog } from '../../src/modules/catalog/index';
import type { DatasetProduct } from './set-de-prueba';

/** Carga el catálogo del set de prueba en la BD. Devuelve las traducciones id ↔ clave. */
export async function loadDataset(db: Database, catalog: readonly DatasetProduct[]) {
  const variantIds = await upsertCatalog(
    db,
    catalog.map((p) => ({
      category: { name: p.category, accessory: !!p.accessoryCategory },
      brand: p.brand,
      canonicalName: p.name,
      modelNumber: p.model,
      variants: p.variants.map((v) => ({ key: v.key, gtin: v.gtin, attributes: v.attributes })),
    })),
  );
  const variantKey = new Map([...variantIds].map(([key, id]) => [id, key]));
  const rows = await db
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, [...variantIds.values()]));
  const productKey = new Map<string, string>();
  for (const r of rows) {
    const key = variantKey.get(r.id)!;
    const product = catalog.find((p) => p.variants.some((v) => v.key === key))!;
    productKey.set(r.productId, product.key);
  }
  return {
    variantIds,
    variantKey: (id: string) => variantKey.get(id) ?? id,
    productKey: (id: string) => productKey.get(id) ?? id,
  };
}
