import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { products, productVariants, type VariantAttributes } from './catalog';
import { merchants } from './merchants';

export const offerCondition = pgEnum('offer_condition', ['new', 'used', 'refurbished']);
export const offerAvailability = pgEnum('offer_availability', [
  'in_stock',
  'out_of_stock',
  'preorder',
  'unknown',
]);
export const matchStatus = pgEnum('match_status', ['pending', 'auto', 'manual', 'rejected']);

/** Dinero en pesos COP enteros (§6). `mode: 'number'` es exacto hasta 2^53. */
const cop = (name?: string) =>
  name ? bigint(name, { mode: 'number' }) : bigint({ mode: 'number' });

/**
 * Oferta = una variante vendida por un comerciante, a un precio (§6). Dueño: módulo `ingestion`
 * (la escribe la ingesta; `variant_id` y `match_*` los escribe `matching` en H3).
 *
 * Además de los campos de §6 guarda lo que la normalización extrajo del título (`gtin`, `brand`,
 * `model_number`, `attributes`), que es la entrada del matching de H3: así no hay que volver a
 * leer la fuente para emparejar.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => productVariants.id, { onDelete: 'set null' }),
    /**
     * Producto de `variant_id`, desnormalizado para la búsqueda (§8.3): los listados leen las
     * ofertas de cientos de productos y así no pasan por `product_variants`. Lo mantienen
     * triggers de la migración 0004; la aplicación no lo escribe.
     */
    productId: uuid().references(() => products.id, { onDelete: 'set null' }),
    externalId: text().notNull(),
    titleRaw: text().notNull(),
    url: text().notNull(),
    imageUrl: text(),
    sellerName: text(),
    isMarketplace: boolean().notNull().default(false),
    condition: offerCondition().notNull().default('new'),
    availability: offerAvailability().notNull().default('unknown'),
    price: cop().notNull(),
    listPrice: cop(),
    currency: text().notNull().default('COP'),
    gtin: text(),
    brand: text(),
    modelNumber: text(),
    attributes: jsonb().$type<VariantAttributes>().notNull().default({}),
    /** Categoría tal como la da la fuente (p. ej. "Tecnología > Celulares"). La usa el matching (H3) al crear fichas. */
    category: text(),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    matchStatus: matchStatus().notNull().default('pending'),
    matchConfidence: real(),
    /**
     * Nivel de §8.2 que decidió el enlace automático: 1 GTIN, 2 marca + modelo, 3 marca +
     * trigramas, 5 ficha nueva creada a partir de la oferta. Nulo si está pendiente o la decidió
     * una persona (`manual`).
     */
    matchLevel: smallint(),
  },
  (t) => [
    unique('offers_merchant_external_unique').on(t.merchantId, t.externalId),
    index('offers_variant_id_idx').on(t.variantId),
    // Cubre la lectura de ofertas vigentes de los listados (index-only scan, §8.3).
    index('offers_product_listing_idx').on(
      t.productId,
      t.merchantId,
      t.price,
      t.lastSeenAt,
      t.availability,
      t.currency,
      t.listPrice,
      t.id,
      t.variantId,
    ),
    index('offers_gtin_idx').on(t.gtin),
    index('offers_match_status_idx').on(t.matchStatus),
    // Recorrido de las pendientes del matching en orden de llegada (H3).
    index('offers_match_pending_idx')
      .on(t.firstSeenAt, t.id)
      .where(sql`${t.matchStatus} = 'pending'`),
    index('offers_last_seen_at_idx').on(t.lastSeenAt),
    check('offers_price_positive', sql`${t.price} > 0`),
    check(
      'offers_list_price_gte_price',
      sql`${t.listPrice} is null or ${t.listPrice} >= ${t.price}`,
    ),
  ],
);

/**
 * Historial de precios (§6): una fila al ver la oferta por primera vez y otra solo cuando cambia
 * `price` o `list_price`. Dueño: módulo `ingestion` (lo lee `pricing` en H5).
 * Se particionará por mes cuando supere 10 M filas.
 */
export const priceHistory = pgTable(
  'price_history',
  {
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    price: cop().notNull(),
    listPrice: cop(),
    observedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.observedAt] })],
);

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
