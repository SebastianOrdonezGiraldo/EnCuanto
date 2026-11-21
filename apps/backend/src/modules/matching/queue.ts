import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Log } from '../../shared/log';
import { safeErrorInfo, safeErrorMessage } from '../../shared/safe-error';

/** Cola de matching (§5: BullMQ). Cada job empareja todas las ofertas pendientes. */
export const MATCHING_QUEUE = 'offer-matching';

export interface MatchingJobData {
  /** Qué lo pidió: un sync con cambios, el arranque del worker o el admin. */
  trigger: 'sync' | 'startup' | 'admin';
  merchantSlug?: string;
}

export function createMatchingQueue(
  connection: ConnectionOptions,
  prefix?: string,
): Queue<MatchingJobData> {
  return new Queue<MatchingJobData>(MATCHING_QUEUE, {
    connection,
    ...(prefix ? { prefix } : {}),
    defaultJobOptions: {
      // Un fallo deja las ofertas pendientes: las recoge el siguiente job.
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  });
}

/**
 * Encola un matching. Sin deduplicación: un job que llega mientras otro corre podría quedar
 * descartado y dejar sin emparejar las ofertas que entraron después de su última pasada. Un job
 * de más no cuesta nada (no encuentra pendientes); uno de menos deja ofertas sin ficha.
 */
export async function enqueueMatching(
  queue: Queue<MatchingJobData>,
  data: MatchingJobData,
): Promise<string | undefined> {
  const job = await queue.add('match', data);
  return job.id;
}

/**
 * BullMQ guarda en Redis el mensaje del error con el que falla un job (`failedReason`) y lo pasa
 * a los listeners: sale sin datos (solo tipo y código), nunca el mensaje original.
 */
export class MatchingJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchingJobError';
  }
}

export function sanitizedProcessor(
  processor: (job: Job<MatchingJobData>, signal?: AbortSignal) => Promise<unknown>,
) {
  return async (job: Job<MatchingJobData>, _token?: string, signal?: AbortSignal) => {
    try {
      return await processor(job, signal);
    } catch (error) {
      throw new MatchingJobError(`matching falló (${safeErrorMessage(error)})`);
    }
  };
}

/** Un job a la vez por proceso: las decisiones se serializan con un advisory lock de todos modos. */
export function createMatchingWorker(
  connection: ConnectionOptions,
  processor: (job: Job<MatchingJobData>, signal?: AbortSignal) => Promise<unknown>,
  prefix?: string,
): Worker<MatchingJobData> {
  return new Worker<MatchingJobData>(MATCHING_QUEUE, sanitizedProcessor(processor), {
    connection,
    concurrency: 1,
    ...(prefix ? { prefix } : {}),
  });
}

/**
 * Registra `failed` y `error` del worker de matching. Sin un listener de `error`, un fallo de
 * conexión con Redis es un evento no manejado y Node termina el proceso (también el worker de sync).
 */
export function logMatchingWorkerEvents(worker: Worker<MatchingJobData>, log: Log): void {
  worker.on('failed', (job, err) =>
    log.warn({ job_id: job?.id, ...safeErrorInfo(err) }, 'matching: job falló'),
  );
  worker.on('error', (err) => log.error(safeErrorInfo(err), 'matching: error del worker'));
}
