import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalog';
import { offers } from './offers';

/**
 * Usuarios (§6). Solo lo mínimo de Google (Ley 1581, §4.3). Se usan desde H4.
 * Dueño: módulo `users`.
 */
export const users = pgTable('users', {
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  googleSub: text().notNull().unique('users_google_sub_unique'),
  email: text().notNull(),
  name: text(),
  avatarUrl: text(),
  prefs: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
});

/** Favoritos sobre variante (§6). Dueño: módulo `favorites` (H4). */
export const favorites = pgTable(
  'favorites',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    offerId: uuid().references(() => offers.id, { onDelete: 'set null' }),
    priceAtSave: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.variantId] })],
);

/** Alertas de precio (§6). Dueño: módulo `alerts` (H5). */
export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    targetPrice: bigint({ mode: 'number' }).notNull(),
    active: boolean().notNull().default(true),
    lastNotifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('price_alerts_user_id_idx').on(t.userId),
    index('price_alerts_variant_active_idx').on(t.variantId, t.active),
  ],
);

export type User = typeof users.$inferSelect;
