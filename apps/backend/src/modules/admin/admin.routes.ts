import {
  adminListQuerySchema,
  merchantSlugSchema,
  type MerchantStatusDto,
  type QuarantinedRecordDto,
  type SyncRunDto,
} from '@encuanto/contracts';
import type { Database, ProviderSyncRun } from '@encuanto/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors';
import {
  countOffersByMerchant,
  latestRunByMerchant,
  listQuarantined,
  listSyncRuns,
} from '../ingestion/index';
import { getMerchantBySlug, listMerchants } from '../merchants/index';

export interface AdminDeps {
  db: Database;
  /** Token de administración (≥ 32 caracteres). Se compara en tiempo constante. */
  token: string;
  /** Encola un sync del comerciante y devuelve el id del job. */
  enqueueSync: (merchantSlug: string) => Promise<string | undefined>;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Parámetros inválidos', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function runDto(run: ProviderSyncRun, merchant: string): SyncRunDto {
  return {
    id: run.id,
    merchant,
    trigger: run.trigger,
    status: run.status,
    started_at: run.startedAt.toISOString(),
    finished_at: iso(run.finishedAt),
    items_seen: run.itemsSeen,
    items_upserted: run.itemsUpserted,
    items_price_changed: run.itemsPriceChanged,
    items_quarantined: run.itemsQuarantined,
    error_summary: run.errorSummary as Record<string, unknown>,
  };
}

/**
 * Admin mínimo de H1 (CU‑9): estado de las fuentes, ejecuciones de sync, cuarentena y
 * sync manual. Protegido con `Authorization: Bearer <ADMIN_TOKEN>` hasta que existan usuarios
 * y roles (H4). Todas las respuestas llevan `cache-control: no-store`.
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const expected = digest(deps.token);

  void app.register(
    async (admin) => {
      admin.addHook('onRequest', async (request: FastifyRequest, reply) => {
        const header = request.headers.authorization ?? '';
        const given = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (!given || !timingSafeEqual(digest(given), expected)) {
          throw new UnauthorizedError('Token de administración inválido');
        }
        reply.header('cache-control', 'no-store');
      });

      admin.get('/merchants', async () => {
        const [merchants, lastRuns, offers] = await Promise.all([
          listMerchants(deps.db),
          latestRunByMerchant(deps.db),
          countOffersByMerchant(deps.db),
        ]);
        const result: MerchantStatusDto[] = merchants.map((m) => {
          const last = lastRuns.get(m.id);
          return {
            slug: m.slug,
            name: m.name,
            source_type: m.sourceType,
            active: m.active,
            has_source: m.providerConfig !== null,
            terms_reviewed_at: iso(m.termsReviewedAt),
            offers: offers.get(m.id) ?? 0,
            last_run: last ? runDto(last, m.slug) : null,
          };
        });
        return { merchants: result };
      });

      admin.get('/sync-runs', async (request) => {
        const query = parse(adminListQuerySchema, request.query);
        const runs = await listSyncRuns(deps.db, {
          merchantSlug: query.merchant,
          limit: query.limit,
        });
        return { runs: runs.map((r) => runDto(r, r.merchantSlug)) };
      });

      admin.get('/quarantine', async (request) => {
        const query = parse(adminListQuerySchema, request.query);
        const rows = await listQuarantined(deps.db, {
          merchantSlug: query.merchant,
          limit: query.limit,
        });
        const records: QuarantinedRecordDto[] = rows.map((r) => ({
          id: r.id,
          merchant: r.merchantSlug,
          sync_run_id: r.syncRunId,
          reason: r.reason,
          payload: r.payload,
          occurrences: r.occurrences,
          created_at: r.createdAt.toISOString(),
          last_seen_at: r.lastSeenAt.toISOString(),
        }));
        return { records };
      });

      admin.post('/merchants/:slug/sync', async (request, reply) => {
        const slug = parse(merchantSlugSchema, (request.params as { slug: string }).slug);
        const merchant = await getMerchantBySlug(deps.db, slug);
        if (!merchant) throw new NotFoundError('Comerciante no encontrado');
        if (!merchant.providerConfig) {
          throw new ValidationError('El comerciante no tiene una fuente configurada');
        }
        const jobId = await deps.enqueueSync(slug);
        return reply.status(202).send({ merchant: slug, job_id: jobId ?? null });
      });
    },
    { prefix: '/api/admin' },
  );
}
