import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
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
    /** Por qué no se emparejó solo (`similitud_media`, `variante_ambigua`, `accesorio`…). */
    reason: text().notNull().default('similitud_media'),
    status: matchReviewStatus().notNull().default('pending'),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('match_reviews_status_idx').on(t.status, t.createdAt),
    // Una sola revisión abierta por oferta.
    uniqueIndex('match_reviews_offer_pending_unique')
      .on(t.offerId)
      .where(sql`${t.status} = 'pending'`),
  ],
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

/**
 * Invalidación de la caché del catálogo pendiente (§8.6) por decisiones de matching. Se escribe
 * en la misma transacción que la decisión, así que no se pierde si la invalidación (Redis) falla
 * o el proceso se cae después de confirmar: la siguiente ejecución del matching la reintenta.
 * Una sola fila; `generation` toma un valor nuevo de la secuencia con cada cambio, para no borrar
 * uno que llegue mientras se invalida.
 */
export const catalogInvalidations = pgTable('catalog_invalidations', {
  id: smallint().primaryKey().default(1),
  /**
   * De una secuencia que no se reinicia al borrar la fila: una marca recreada nunca repite la
   * generación de una anterior, así que limpiar la vieja no borra la nueva.
   */
  generation: bigserial({ mode: 'number' }).notNull(),
  requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
