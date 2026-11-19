import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { productVariants } from './catalog';
import { offers } from './offers';
import { users } from './users';

export const matchReviewStatus = pgEnum('match_review_status', ['pending', 'accepted', 'rejected']);

/** Cola de matching dudoso (§8.2 nivel 4). Dueño: módulo `matching` (H3). */
export const matchReviews = pgTable(
  'match_reviews',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    candidateVariantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    score: real().notNull(),
    status: matchReviewStatus().notNull().default('pending'),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('match_reviews_status_idx').on(t.status, t.createdAt)],
);

/** Consultas de búsqueda (§6). Sin IP en claro. Dueño: módulo `search` (H2). */
export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    qNormalized: text().notNull(),
    filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    resultsCount: integer().notNull(),
    latencyMs: integer().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('search_queries_created_at_idx').on(t.createdAt)],
);

/** Comparaciones con IA (§6, §10). Dueño: módulo `ai` (H6). */
export const aiComparisons = pgTable(
  'ai_comparisons',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    inputHash: text().notNull(),
    variantIds: uuid().array().notNull(),
    context: text(),
    response: jsonb().$type<Record<string, unknown>>(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    tokensIn: integer(),
    tokensOut: integer(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    latencyMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_comparisons_input_hash_idx').on(t.inputHash)],
);

/** Clics de salida a la tienda (§6, `/go/:offerId`). Dueño: módulo `outbound` (H2). */
export const outboundClicks = pgTable(
  'outbound_clicks',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    offerId: uuid()
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    sessionHash: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbound_clicks_offer_created_idx').on(t.offerId, t.createdAt)],
);
