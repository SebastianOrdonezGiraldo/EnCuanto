import { z } from 'zod';

/** Slug de comerciante (minúsculas, números y guiones). */
export const merchantSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

/** Query de los listados del admin: filtro opcional por comerciante y límite. */
export const adminListQuerySchema = z.object({
  merchant: merchantSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const syncRunSchema = z.object({
  id: z.uuid(),
  merchant: z.string(),
  trigger: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'skipped']),
  started_at: z.iso.datetime({ offset: true }),
  finished_at: z.iso.datetime({ offset: true }).nullable(),
  items_seen: z.number().int(),
  items_upserted: z.number().int(),
  items_price_changed: z.number().int(),
  items_quarantined: z.number().int(),
  error_summary: z.record(z.string(), z.unknown()),
});

/** GET /api/admin/sync-runs */
export const syncRunsResponseSchema = z.object({ runs: z.array(syncRunSchema) });

/** GET /api/admin/merchants: estado de cada fuente (CU‑9). */
export const merchantStatusSchema = z.object({
  slug: z.string(),
  name: z.string(),
  source_type: z.enum(['affiliate_feed', 'official_api', 'partner_feed', 'manual']),
  active: z.boolean(),
  has_source: z.boolean(),
  terms_reviewed_at: z.iso.datetime({ offset: true }).nullable(),
  offers: z.number().int(),
  last_run: syncRunSchema.nullable(),
});
export const merchantsStatusResponseSchema = z.object({ merchants: z.array(merchantStatusSchema) });

/** GET /api/admin/quarantine */
export const quarantinedRecordSchema = z.object({
  id: z.uuid(),
  merchant: z.string(),
  sync_run_id: z.uuid().nullable(),
  reason: z.string(),
  payload: z.unknown(),
  occurrences: z.number().int(),
  created_at: z.iso.datetime({ offset: true }),
  last_seen_at: z.iso.datetime({ offset: true }),
});
export const quarantineResponseSchema = z.object({ records: z.array(quarantinedRecordSchema) });

/** POST /api/admin/merchants/:slug/sync → 202 */
export const enqueueSyncResponseSchema = z.object({
  merchant: z.string(),
  job_id: z.string().nullable(),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
export type SyncRunDto = z.infer<typeof syncRunSchema>;
export type MerchantStatusDto = z.infer<typeof merchantStatusSchema>;
export type QuarantinedRecordDto = z.infer<typeof quarantinedRecordSchema>;
