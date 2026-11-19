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
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants, type VariantAttributes } from './catalog';
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
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    matchStatus: matchStatus().notNull().default('pending'),
    matchConfidence: real(),
  },
  (t) => [
    unique('offers_merchant_external_unique').on(t.merchantId, t.externalId),
    index('offers_variant_id_idx').on(t.variantId),
    index('offers_gtin_idx').on(t.gtin),
    index('offers_match_status_idx').on(t.matchStatus),
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
