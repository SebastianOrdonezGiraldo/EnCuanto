import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { merchants } from './merchants';

export const syncRunStatus = pgEnum('sync_run_status', [
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

/** Resumen de errores y alertas de una ejecución. Nunca lleva datos de la fuente ni personales. */
export interface SyncErrorSummary {
  /** Mensaje del error que abortó la ejecución, si lo hubo. */
  error?: string;
  /** Motivo por el que no se ejecutó (`locked`, `circuit_open`). */
  skipped_reason?: string;
  /** Conteo de registros en cuarentena por motivo. */
  quarantine_reasons?: Record<string, number>;
  /** Alertas operativas (§9), p. ej. caída de `items_seen`. */
  alerts?: string[];
}

/** Cada ejecución de sync de un comerciante (§6, §9). Dueño: módulo `ingestion`. */
export const providerSyncRuns = pgTable(
  'provider_sync_runs',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    trigger: text().notNull().default('manual'),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    status: syncRunStatus().notNull().default('running'),
    itemsSeen: integer().notNull().default(0),
    itemsUpserted: integer().notNull().default(0),
    itemsPriceChanged: integer().notNull().default(0),
    itemsQuarantined: integer().notNull().default(0),
    errorSummary: jsonb().$type<SyncErrorSummary>().notNull().default({}),
  },
  (t) => [index('provider_sync_runs_merchant_started_idx').on(t.merchantId, t.startedAt)],
);

/**
 * Registros que no pasaron la validación (§9): nunca llegan a `offers`. Dueño: módulo `ingestion`.
 * `record_hash` (sha256 del payload) evita duplicar el mismo registro inválido en cada sync:
 * se actualiza `last_seen_at` y `occurrences`.
 */
export const quarantinedRecords = pgTable(
  'quarantined_records',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    syncRunId: uuid().references(() => providerSyncRuns.id, { onDelete: 'set null' }),
    recordHash: text().notNull(),
    payload: jsonb().notNull(),
    reason: text().notNull(),
    occurrences: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('quarantined_records_merchant_hash_unique').on(t.merchantId, t.recordHash),
    index('quarantined_records_created_at_idx').on(t.createdAt),
  ],
);

export type ProviderSyncRun = typeof providerSyncRuns.$inferSelect;
export type QuarantinedRecord = typeof quarantinedRecords.$inferSelect;
