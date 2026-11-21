import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Atributos normalizados de una variante u oferta (§6, §8.1). */
export interface VariantAttributes {
  color?: string;
  storage_gb?: number;
  ram_gb?: number;
  capacity_l?: number;
  screen_in?: number;
}

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** Marcas (§6). Dueño: módulo `catalog`. */
export const brands = pgTable('brands', {
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text().notNull(),
  normalizedName: text().notNull().unique('brands_normalized_name_unique'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Categorías jerárquicas (§6). Dueño: módulo `catalog`. */
export const categories = pgTable(
  'categories',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    slug: text().notNull().unique(),
    name: text().notNull(),
    accessory: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('categories_parent_id_idx').on(t.parentId)],
);

/** Producto = el modelo ("Galaxy A56") (§6). Dueño: módulo `catalog`. */
export const products = pgTable(
  'products',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    brandId: uuid().references(() => brands.id, { onDelete: 'restrict' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    canonicalName: text().notNull(),
    modelNumber: text(),
    specs: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // FTS en español sin tildes (§5). immutable_unaccent viene de la migración 0002.
    searchTsv: tsvector().generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('spanish'::regconfig, public.immutable_unaccent(coalesce(${products.canonicalName}, '') || ' ' || coalesce(${products.modelNumber}, '')))`,
    ),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_search_tsv_idx').using('gin', t.searchTsv),
    index('products_canonical_name_trgm_idx').using('gin', t.canonicalName.op('gin_trgm_ops')),
    // Búsqueda (H2, §8.3): la similitud de trigramas se calcula sin tildes ni mayúsculas.
    index('products_name_unaccent_trgm_idx').using(
      'gin',
      sql`public.immutable_unaccent(lower(${t.canonicalName})) gin_trgm_ops`,
    ),
    index('products_brand_id_idx').on(t.brandId),
    index('products_category_id_idx').on(t.categoryId),
  ],
);

/** Variante = atributos concretos, idealmente con GTIN (§6). Dueño: módulo `catalog`. */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    gtin: text(),
    attributes: jsonb().$type<VariantAttributes>().notNull().default({}),
    imageUrl: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_variants_gtin_unique')
      .on(t.gtin)
      .where(sql`${t.gtin} is not null`),
    index('product_variants_product_id_idx').on(t.productId),
  ],
);

export type Brand = typeof brands.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
