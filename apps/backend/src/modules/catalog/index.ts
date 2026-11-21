/** Módulo `catalog`: dueño de brands, categories, products y product_variants (§5). */
export { loadBrandNames, upsertBrands } from './brands.service';
export { upsertCatalog, type CatalogEntryInput, type CatalogVariantInput } from './catalog.service';
export {
  createProduct,
  createVariant,
  ensureBrand,
  ensureCategory,
  fillVariantGtin,
  type NewProductInput,
  type NewVariantInput,
} from './products.service';
