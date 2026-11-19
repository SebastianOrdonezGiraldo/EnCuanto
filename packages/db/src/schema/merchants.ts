import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Origen autorizado de los datos de un comerciante (§4.1 y §9). */
export const merchantSourceType = pgEnum('merchant_source_type', [
  'affiliate_feed',
  'official_api',
  'partner_feed',
  'manual',
]);

/**
 * Comerciantes (§6). Es la primera tabla del catálogo; el resto llega en H1.
 * Dueño: módulo `merchants`.
 */
export const merchants = pgTable('merchants', {
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: text().notNull().unique(),
  name: text().notNull(),
  brandColor: text(),
  platform: text(),
  sourceType: merchantSourceType().notNull(),
  active: boolean().notNull().default(true),
  termsReviewedAt: timestamp({ withTimezone: true }),
  affiliateTemplate: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
