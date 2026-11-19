import type { Database } from '@encuanto/db';
import type { Queue } from 'bullmq';
import type { Log } from '../../shared/log';
import { listSyncableMerchants } from '../merchants/index';
import { scheduleSyncs, type SyncJobData } from './queue';

/**
 * Deja un scheduler por cada comerciante activo con fuente y quita el resto. Con intervalo 0
 * los quita todos. Es idempotente: el worker lo repite periódicamente, así una fuente creada o
 * activada después del arranque (p. ej. con el seed) se programa sin reiniciar.
 */
export async function reconcileSchedules(
  db: Database,
  queue: Queue<SyncJobData>,
  intervalMinutes: number,
): Promise<string[]> {
  const slugs = intervalMinutes > 0 ? (await listSyncableMerchants(db)).map((m) => m.slug) : [];
  await scheduleSyncs(queue, slugs, intervalMinutes * 60_000);
  return slugs;
}

/**
 * Ejecuta `reconcileSchedules` al arrancar y cada `everyMs`, sin solapar ejecuciones.
 * Un fallo (BD o Redis caídos) se registra y se reintenta en la siguiente vuelta.
 * Devuelve la función que lo detiene.
 */
export function startScheduleReconciler(
  run: () => Promise<string[]>,
  everyMs: number,
  log: Log,
): { ready: Promise<void>; stop: () => void } {
  let running = false;
  let last = '';
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const slugs = await run();
      const key = slugs.join(',');
      if (key !== last) log.info({ merchants: slugs.length }, 'syncs programados');
      last = key;
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : 'error desconocido' },
        'no se pudieron reconciliar los syncs programados',
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { ready: tick(), stop: () => clearInterval(timer) };
}
