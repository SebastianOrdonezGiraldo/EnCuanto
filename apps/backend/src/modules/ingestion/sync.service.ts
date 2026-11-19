import {
  offers,
  priceHistory,
  providerSyncRuns,
  quarantinedRecords,
  type DbClient,
  type Merchant,
  type NewOffer,
  type SyncErrorSummary,
} from '@encuanto/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Log } from '../../shared/log';
import { NotFoundError } from '../../shared/errors';
import { loadBrandNames } from '../catalog/index';
import { getMerchantBySlug } from '../merchants/index';
import { buildBrandDictionary, normalizeOffer, type BrandDictionary } from '../normalization/index';
import {
  createAdapter,
  rawOfferSchema,
  safeSyncErrorMessage,
  type ProviderAdapter,
} from '../providers/index';
import { boundedPayload, recordHash, zodReason } from './quarantine';
import { DROP_THRESHOLD, isCircuitOpen, recentItemsSeenAverage } from './runs.service';

/**
 * Campos de la oferta que, si cambian sin cambiar el precio, también modifican lo que ve el
 * usuario (disponibilidad, título, enlace…) y por tanto invalidan la caché del catálogo.
 */
const CONTENT_FIELDS = [
  'titleRaw',
  'url',
  'imageUrl',
  'sellerName',
  'isMarketplace',
  'condition',
  'availability',
  'currency',
  'gtin',
  'brand',
  'modelNumber',
  'attributes',
] as const;

/** JSON con claves ordenadas: jsonb no conserva el orden de las claves. */
function stable(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(',')}}`;
}

function contentDiffers(old: Record<string, unknown>, next: NewOffer): boolean {
  return CONTENT_FIELDS.some((f) => stable(old[f]) !== stable(next[f]));
}

/** Tamaño de lote para upsert de ofertas y cuarentena. */
export const BATCH_SIZE = 500;

export interface SyncDeps {
  db: DbClient;
  fixturesDir: string;
  log: Log;
  /** Para tests: sustituye el adaptador que se construye desde `provider_config`. */
  adapterFor?: (merchantSlug: string) => ProviderAdapter;
  /** Se llama al terminar un sync con cambios (sube la versión de catálogo, §8.6). */
  onCatalogChanged?: () => Promise<void>;
}

export interface SyncOptions {
  trigger?: string;
  signal?: AbortSignal;
}

export interface SyncResult {
  runId: string;
  merchantSlug: string;
  status: 'succeeded' | 'failed' | 'skipped';
  itemsSeen: number;
  itemsUpserted: number;
  itemsInserted: number;
  itemsPriceChanged: number;
  /** Ofertas existentes con otros cambios (disponibilidad, título, URL…) y el mismo precio. */
  itemsContentChanged: number;
  itemsQuarantined: number;
  summary: SyncErrorSummary;
}

interface PendingQuarantine {
  payload: unknown;
  hash: string;
  reason: string;
}

/**
 * Sincroniza un comerciante (§9): lee su fuente, valida con Zod, normaliza (§8.1), hace upsert
 * por `(merchant_id, external_id)` y escribe `price_history` solo si cambió el precio.
 * Reejecutarlo con los mismos datos es idempotente: no crea ofertas ni historial nuevos.
 */
export async function runSync(
  deps: SyncDeps,
  merchantSlug: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { db } = deps.db;
  const trigger = options.trigger ?? 'manual';
  const signal = options.signal ?? new AbortController().signal;
  const merchant = await getMerchantBySlug(db, merchantSlug);
  if (!merchant) throw new NotFoundError('Comerciante no encontrado', { merchant: merchantSlug });

  const skipped = async (reason: string): Promise<SyncResult> => {
    const summary: SyncErrorSummary = { skipped_reason: reason };
    const [run] = await db
      .insert(providerSyncRuns)
      .values({
        merchantId: merchant.id,
        trigger,
        status: 'skipped',
        finishedAt: sql`now()`,
        errorSummary: summary,
      })
      .returning({ id: providerSyncRuns.id });
    return {
      runId: run!.id,
      merchantSlug,
      status: 'skipped',
      itemsSeen: 0,
      itemsUpserted: 0,
      itemsInserted: 0,
      itemsPriceChanged: 0,
      itemsContentChanged: 0,
      itemsQuarantined: 0,
      summary,
    };
  };

  if (!merchant.active) return skipped('inactive');
  if (await isCircuitOpen(db, merchant.id)) {
    deps.log.error({ merchant: merchantSlug, alert: 'circuit_open' }, 'sync: circuito abierto');
    return skipped('circuit_open');
  }

  // Advisory lock de sesión por comerciante: un solo sync a la vez por tienda, aunque haya
  // varios workers. Se toma en una conexión reservada y se suelta antes de devolverla al pool.
  const lockName = `sync:${merchant.id}`;
  const reserved = await deps.db.sql.reserve();
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${lockName}, 0)) as locked`;
    if (!lock?.locked) return await skipped('locked');
    try {
      return await syncLocked(deps, merchant, trigger, signal);
    } finally {
      await reserved`select pg_advisory_unlock(hashtextextended(${lockName}, 0))`;
    }
  } finally {
    reserved.release();
  }
}

async function syncLocked(
  deps: SyncDeps,
  merchant: Merchant,
  trigger: string,
  signal: AbortSignal,
): Promise<SyncResult> {
  const { db } = deps.db;
  const merchantId = merchant.id;
  const merchantSlug = merchant.slug;
  const [run] = await db
    .insert(providerSyncRuns)
    .values({ merchantId, trigger, status: 'running' })
    .returning({ id: providerSyncRuns.id });
  const runId = run!.id;
  const log = deps.log;
  const counts = {
    seen: 0,
    upserted: 0,
    inserted: 0,
    priceChanged: 0,
    contentChanged: 0,
    quarantined: 0,
  };
  const reasons: Record<string, number> = {};
  log.info({ merchant: merchantSlug, run_id: runId, trigger }, 'sync: inicio');

  try {
    const adapter =
      deps.adapterFor?.(merchantSlug) ??
      createAdapter(
        {
          slug: merchantSlug,
          sourceType: merchant.sourceType,
          providerConfig: merchant.providerConfig,
        },
        { fixturesDir: deps.fixturesDir },
      );
    const brands = buildBrandDictionary(await loadBrandNames(db));

    let batch: NewOffer[] = [];
    let quarantine: PendingQuarantine[] = [];
    const flush = async () => {
      if (batch.length > 0) {
        const r = await writeOffers(deps.db, merchantId, batch);
        counts.upserted += r.upserted;
        counts.inserted += r.inserted;
        counts.priceChanged += r.priceChanged;
        counts.contentChanged += r.contentChanged;
        batch = [];
      }
      if (quarantine.length > 0) {
        await writeQuarantine(deps.db, merchantId, runId, quarantine);
        quarantine = [];
      }
    };

    // Deduplicación de toda la ejecución, no solo del lote: así el resultado no depende del
    // orden del feed ni de BATCH_SIZE. Un external_id repetido es una anomalía de la fuente:
    // vale la primera aparición y las demás van a cuarentena. `occurrences` cuenta ejecuciones.
    const seenIds = new Set<string>();
    const seenHashes = new Set<string>();
    const toQuarantine = (entry: PendingQuarantine) => {
      counts.quarantined++;
      reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
      if (seenHashes.has(entry.hash)) return;
      seenHashes.add(entry.hash);
      quarantine.push(entry);
    };

    for await (const record of adapter.sync({ merchantSlug, signal })) {
      counts.seen++;
      const entry = toOfferOrQuarantine(record, merchantId, brands);
      if ('reason' in entry) {
        toQuarantine(entry);
      } else if (seenIds.has(entry.externalId)) {
        toQuarantine(quarantined(record, 'duplicate_external_id'));
      } else {
        seenIds.add(entry.externalId);
        batch.push(entry);
      }
      if (batch.length >= BATCH_SIZE || quarantine.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const summary: SyncErrorSummary = {};
    if (Object.keys(reasons).length > 0) summary.quarantine_reasons = reasons;
    const average = await recentItemsSeenAverage(db, merchantId, runId);
    if (average !== null && average > 0 && counts.seen < average * (1 - DROP_THRESHOLD)) {
      summary.alerts = [
        `items_seen_drop: ${counts.seen} frente a una media de ${Math.round(average)}`,
      ];
      log.warn(
        {
          merchant: merchantSlug,
          run_id: runId,
          alert: 'items_seen_drop',
          items_seen: counts.seen,
          average,
        },
        'sync: caída de items_seen',
      );
    }

    await finishRun(deps.db, runId, 'succeeded', counts, summary);
    log.info({ merchant: merchantSlug, run_id: runId, ...counts }, 'sync: fin');
    // Cualquier cambio visible invalida la caché de búsqueda (§8.6), no solo el precio.
    // Un fallo de la caché no convierte en fallido un sync ya guardado.
    if (counts.inserted + counts.priceChanged + counts.contentChanged > 0) {
      await deps.onCatalogChanged?.().catch((error: unknown) =>
        log.warn(
          {
            merchant: merchantSlug,
            run_id: runId,
            err: error instanceof Error ? error.message : 'error desconocido',
          },
          'sync: no se pudo invalidar la caché del catálogo',
        ),
      );
    }
    return result(runId, merchantSlug, 'succeeded', counts, summary);
  } catch (error) {
    // Mensaje saneado: nunca bytes del feed (los parsers los citan) ni URLs con tokens.
    const message = safeSyncErrorMessage(error).slice(0, 500);
    const summary: SyncErrorSummary = { error: message };
    if (Object.keys(reasons).length > 0) summary.quarantine_reasons = reasons;
    await finishRun(deps.db, runId, 'failed', counts, summary);
    log.error({ merchant: merchantSlug, run_id: runId, err: message }, 'sync: falló');
    throw error;
  }
}

function result(
  runId: string,
  merchantSlug: string,
  status: SyncResult['status'],
  c: {
    seen: number;
    upserted: number;
    inserted: number;
    priceChanged: number;
    contentChanged: number;
    quarantined: number;
  },
  summary: SyncErrorSummary,
): SyncResult {
  return {
    runId,
    merchantSlug,
    status,
    itemsSeen: c.seen,
    itemsUpserted: c.upserted,
    itemsInserted: c.inserted,
    itemsPriceChanged: c.priceChanged,
    itemsContentChanged: c.contentChanged,
    itemsQuarantined: c.quarantined,
    summary,
  };
}

async function finishRun(
  client: DbClient,
  runId: string,
  status: 'succeeded' | 'failed',
  c: { seen: number; upserted: number; priceChanged: number; quarantined: number },
  summary: SyncErrorSummary,
): Promise<void> {
  await client.db
    .update(providerSyncRuns)
    .set({
      status,
      finishedAt: sql`now()`,
      itemsSeen: c.seen,
      itemsUpserted: c.upserted,
      itemsPriceChanged: c.priceChanged,
      itemsQuarantined: c.quarantined,
      errorSummary: summary,
    })
    .where(eq(providerSyncRuns.id, runId));
}

function quarantined(record: unknown, reason: string): PendingQuarantine {
  const payload = boundedPayload(record);
  return { payload, hash: recordHash(payload), reason };
}

/** Valida y normaliza un registro; si no sirve, devuelve lo que va a cuarentena. */
export function toOfferOrQuarantine(
  record: unknown,
  merchantId: string,
  brands: BrandDictionary,
): NewOffer | PendingQuarantine {
  const quarantine = (reason: string) => quarantined(record, reason);
  const parsed = rawOfferSchema.safeParse(record);
  if (!parsed.success) return quarantine(zodReason(parsed.error));
  const raw = parsed.data;
  const normalized = normalizeOffer(
    {
      title: raw.title,
      brand: raw.brand,
      gtin: raw.gtin,
      price: raw.price,
      listPrice: raw.listPrice,
    },
    brands,
  );
  if (!normalized.ok) return quarantine(normalized.reason);
  const n = normalized.value;
  return {
    merchantId,
    externalId: raw.externalId,
    titleRaw: raw.title,
    url: raw.url,
    imageUrl: raw.imageUrl ?? null,
    sellerName: raw.sellerName ?? null,
    isMarketplace: raw.isMarketplace,
    condition: raw.condition,
    availability: raw.availability,
    price: n.price,
    listPrice: n.listPrice,
    currency: raw.currency,
    gtin: n.gtin,
    brand: n.brand,
    modelNumber: n.modelNumber,
    attributes: n.attributes,
  };
}

/**
 * Upsert de un lote y su historial en una transacción. Se leen antes los precios actuales para
 * escribir `price_history` solo en ofertas nuevas o con precio/precio de lista distinto.
 * El advisory lock garantiza que nadie más escribe ofertas de este comerciante a la vez.
 */
async function writeOffers(client: DbClient, merchantId: string, rows: NewOffer[]) {
  // Defensa: runSync ya descarta external_id repetidos, y ON CONFLICT no admite duplicados.
  const unique = [...new Map(rows.map((r) => [r.externalId, r])).values()];
  return client.db.transaction(async (tx) => {
    const existing = await tx
      .select({
        externalId: offers.externalId,
        price: offers.price,
        listPrice: offers.listPrice,
        ...Object.fromEntries(CONTENT_FIELDS.map((f) => [f, offers[f]])),
      })
      .from(offers)
      .where(
        and(
          eq(offers.merchantId, merchantId),
          inArray(
            offers.externalId,
            unique.map((r) => r.externalId),
          ),
        ),
      );
    const before = new Map(existing.map((e) => [e.externalId, e]));

    const written = await tx
      .insert(offers)
      .values(unique)
      .onConflictDoUpdate({
        target: [offers.merchantId, offers.externalId],
        set: {
          titleRaw: sql`excluded.title_raw`,
          url: sql`excluded.url`,
          imageUrl: sql`excluded.image_url`,
          sellerName: sql`excluded.seller_name`,
          isMarketplace: sql`excluded.is_marketplace`,
          condition: sql`excluded.condition`,
          availability: sql`excluded.availability`,
          price: sql`excluded.price`,
          listPrice: sql`excluded.list_price`,
          currency: sql`excluded.currency`,
          gtin: sql`excluded.gtin`,
          brand: sql`excluded.brand`,
          modelNumber: sql`excluded.model_number`,
          attributes: sql`excluded.attributes`,
          lastSeenAt: sql`now()`,
          lastChangedAt: sql`case when ${offers.price} is distinct from excluded.price
            or ${offers.listPrice} is distinct from excluded.list_price
            then now() else ${offers.lastChangedAt} end`,
        },
      })
      .returning({
        id: offers.id,
        externalId: offers.externalId,
        price: offers.price,
        listPrice: offers.listPrice,
      });

    let inserted = 0;
    let priceChanged = 0;
    let contentChanged = 0;
    const incoming = new Map(unique.map((r) => [r.externalId, r]));
    const history: (typeof priceHistory.$inferInsert)[] = [];
    for (const row of written) {
      const old = before.get(row.externalId);
      if (!old) {
        inserted++;
      } else if (old.price !== row.price || old.listPrice !== row.listPrice) {
        priceChanged++;
      } else {
        if (contentDiffers(old as Record<string, unknown>, incoming.get(row.externalId)!)) {
          contentChanged++;
        }
        continue;
      }
      history.push({ offerId: row.id, price: row.price, listPrice: row.listPrice });
    }
    if (history.length > 0) await tx.insert(priceHistory).values(history);
    return { upserted: written.length, inserted, priceChanged, contentChanged };
  });
}

/** Guarda la cuarentena sin duplicar: el mismo registro inválido suma `occurrences`. */
async function writeQuarantine(
  client: DbClient,
  merchantId: string,
  runId: string,
  items: PendingQuarantine[],
): Promise<void> {
  const unique = [...new Map(items.map((i) => [i.hash, i])).values()];
  await client.db
    .insert(quarantinedRecords)
    .values(
      unique.map((i) => ({
        merchantId,
        syncRunId: runId,
        recordHash: i.hash,
        payload: i.payload,
        reason: i.reason,
      })),
    )
    .onConflictDoUpdate({
      target: [quarantinedRecords.merchantId, quarantinedRecords.recordHash],
      set: {
        syncRunId: runId,
        reason: sql`excluded.reason`,
        occurrences: sql`${quarantinedRecords.occurrences} + 1`,
        lastSeenAt: sql`now()`,
      },
    });
}
