import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';

/** Cola de sincronización de fuentes (§5: BullMQ sobre Redis). */
export const SYNC_QUEUE = 'provider-sync';

export interface SyncJobData {
  merchantSlug: string;
  trigger: 'schedule' | 'manual' | 'admin';
}

/** Conexión para BullMQ: exige `maxRetriesPerRequest: null` (los workers bloquean en Redis). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/** `prefix` separa las claves en Redis (los tests usan uno propio para no tocar el de dev). */
export function createSyncQueue(
  connection: ConnectionOptions,
  prefix?: string,
): Queue<SyncJobData> {
  return new Queue<SyncJobData>(SYNC_QUEUE, {
    connection,
    ...(prefix ? { prefix } : {}),
    defaultJobOptions: {
      // Los reintentos con jitter ya los hace la descarga del feed (§9); un fallo del job queda
      // en provider_sync_runs y el siguiente intento es la próxima ejecución programada.
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  });
}

/**
 * Encola un sync. La deduplicación por comerciante evita encolar dos veces la misma tienda
 * mientras hay un job pendiente o en curso; el advisory lock de `runSync` cubre el resto.
 */
export async function enqueueSync(
  queue: Queue<SyncJobData>,
  merchantSlug: string,
  trigger: SyncJobData['trigger'],
): Promise<string | undefined> {
  const job = await queue.add(
    'sync',
    { merchantSlug, trigger },
    { deduplication: { id: `sync-${merchantSlug}` } },
  );
  return job.id;
}

/**
 * Programa un sync periódico por comerciante (job schedulers de BullMQ, idempotente) y quita los
 * de comerciantes que ya no se sincronizan.
 */
export async function scheduleSyncs(
  queue: Queue<SyncJobData>,
  merchantSlugs: readonly string[],
  everyMs: number,
): Promise<void> {
  const wanted = new Set(merchantSlugs.map((slug) => `schedule-${slug}`));
  for (const slug of merchantSlugs) {
    await queue.upsertJobScheduler(
      `schedule-${slug}`,
      { every: everyMs },
      { name: 'sync', data: { merchantSlug: slug, trigger: 'schedule' } },
    );
  }
  for (const scheduler of await queue.getJobSchedulers()) {
    if (scheduler.key && !wanted.has(scheduler.key)) await queue.removeJobScheduler(scheduler.key);
  }
}

export function createSyncWorker(
  connection: ConnectionOptions,
  processor: (job: Job<SyncJobData>, signal?: AbortSignal) => Promise<unknown>,
  concurrency: number,
  prefix?: string,
): Worker<SyncJobData> {
  return new Worker<SyncJobData>(SYNC_QUEUE, (job, _token, signal) => processor(job, signal), {
    connection,
    concurrency,
    ...(prefix ? { prefix } : {}),
  });
}
