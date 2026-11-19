import {
  merchants,
  providerSyncRuns,
  quarantinedRecords,
  type Database,
  type ProviderSyncRun,
} from '@encuanto/db';
import { and, desc, eq, ne, sql } from 'drizzle-orm';

/** Circuit breaker (§9): 5 fallos seguidos → pausa de 30 min. */
export const CIRCUIT_FAILURES = 5;
export const CIRCUIT_PAUSE_MS = 30 * 60 * 1000;
/** Alerta si `items_seen` cae más de 50 % frente a la media de las últimas 7 ejecuciones (§9). */
export const DROP_WINDOW = 7;
export const DROP_THRESHOLD = 0.5;

/** ¿Está abierto el circuito? Cuenta las últimas ejecuciones reales (sin las omitidas). */
export async function isCircuitOpen(
  db: Database,
  merchantId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const recent = await db
    .select({ status: providerSyncRuns.status, finishedAt: providerSyncRuns.finishedAt })
    .from(providerSyncRuns)
    .where(and(eq(providerSyncRuns.merchantId, merchantId), ne(providerSyncRuns.status, 'skipped')))
    .orderBy(desc(providerSyncRuns.startedAt))
    .limit(CIRCUIT_FAILURES);
  if (recent.length < CIRCUIT_FAILURES || recent.some((r) => r.status !== 'failed')) return false;
  const last = recent[0]!.finishedAt;
  return last !== null && now.getTime() - last.getTime() < CIRCUIT_PAUSE_MS;
}

/** Media de `items_seen` de las últimas ejecuciones correctas, sin contar `excludeRunId`. */
export async function recentItemsSeenAverage(
  db: Database,
  merchantId: string,
  excludeRunId: string,
): Promise<number | null> {
  const rows = await db
    .select({ seen: providerSyncRuns.itemsSeen })
    .from(providerSyncRuns)
    .where(
      and(
        eq(providerSyncRuns.merchantId, merchantId),
        eq(providerSyncRuns.status, 'succeeded'),
        ne(providerSyncRuns.id, excludeRunId),
      ),
    )
    .orderBy(desc(providerSyncRuns.startedAt))
    .limit(DROP_WINDOW);
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + r.seen, 0) / rows.length;
}

export interface SyncRunView extends ProviderSyncRun {
  merchantSlug: string;
}

export async function listSyncRuns(
  db: Database,
  filter: { merchantSlug?: string; limit: number },
): Promise<SyncRunView[]> {
  const rows = await db
    .select({ run: providerSyncRuns, merchantSlug: merchants.slug })
    .from(providerSyncRuns)
    .innerJoin(merchants, eq(merchants.id, providerSyncRuns.merchantId))
    .where(filter.merchantSlug ? eq(merchants.slug, filter.merchantSlug) : undefined)
    .orderBy(desc(providerSyncRuns.startedAt))
    .limit(filter.limit);
  return rows.map((r) => ({ ...r.run, merchantSlug: r.merchantSlug }));
}

/** Última ejecución de cada comerciante (estado de las fuentes). */
export async function latestRunByMerchant(db: Database): Promise<Map<string, ProviderSyncRun>> {
  const rows = await db
    .selectDistinctOn([providerSyncRuns.merchantId])
    .from(providerSyncRuns)
    .orderBy(providerSyncRuns.merchantId, desc(providerSyncRuns.startedAt));
  return new Map(rows.map((r) => [r.merchantId, r]));
}

export async function listQuarantined(
  db: Database,
  filter: { merchantSlug?: string; limit: number },
) {
  return db
    .select({
      id: quarantinedRecords.id,
      merchantSlug: merchants.slug,
      syncRunId: quarantinedRecords.syncRunId,
      reason: quarantinedRecords.reason,
      payload: quarantinedRecords.payload,
      occurrences: quarantinedRecords.occurrences,
      createdAt: quarantinedRecords.createdAt,
      lastSeenAt: quarantinedRecords.lastSeenAt,
    })
    .from(quarantinedRecords)
    .innerJoin(merchants, eq(merchants.id, quarantinedRecords.merchantId))
    .where(filter.merchantSlug ? eq(merchants.slug, filter.merchantSlug) : undefined)
    .orderBy(desc(quarantinedRecords.lastSeenAt))
    .limit(filter.limit);
}

/** Cuenta ofertas por comerciante (para el estado de las fuentes y el seed). */
export async function countOffersByMerchant(db: Database): Promise<Map<string, number>> {
  const rows = await db.execute<{ merchant_id: string; n: number }>(
    sql`select merchant_id, count(*)::int as n from offers group by merchant_id`,
  );
  return new Map(rows.map((r) => [r.merchant_id, r.n]));
}
