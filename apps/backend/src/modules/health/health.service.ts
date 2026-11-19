import type { DependencyCheck, HealthResponse } from '@encuanto/contracts';

export interface HealthDeps {
  /** Lanza si la base de datos no responde. Debe cancelar la consulta cuando se aborta `signal`. */
  pingDatabase: (signal: AbortSignal) => Promise<void>;
  /** Lanza si Redis no responde. */
  pingRedis: (signal: AbortSignal) => Promise<void>;
  version: string;
  startedAt: number;
  /** Tiempo máximo por comprobación. */
  timeoutMs?: number;
}

/** Ejecuta la comprobación con un límite de tiempo y aborta la operación subyacente al vencer. */
function withTimeout(fn: (signal: AbortSignal) => Promise<void>, ms: number): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`sin respuesta en ${ms} ms`));
    }, ms);
  });
  return Promise.race([fn(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

async function check(
  fn: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    await withTimeout(fn, timeoutMs);
    return { status: 'ok', latency_ms: Math.round(performance.now() - start) };
  } catch (error) {
    return {
      status: 'error',
      latency_ms: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : 'error desconocido',
    };
  }
}

/** Comprueba BD y Redis en paralelo. Las colas (BullMQ) se añaden en H1. */
export async function getHealth(deps: HealthDeps): Promise<HealthResponse> {
  const timeoutMs = deps.timeoutMs ?? 2000;
  const [database, redis] = await Promise.all([
    check(deps.pingDatabase, timeoutMs),
    check(deps.pingRedis, timeoutMs),
  ]);
  const allOk = database.status === 'ok' && redis.status === 'ok';
  return {
    status: allOk ? 'ok' : 'degraded',
    version: deps.version,
    uptime_s: Math.round((Date.now() - deps.startedAt) / 1000),
    checks: { database, redis },
  };
}
