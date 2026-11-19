/** Token bucket por comerciante (§9): `rps` fichas por segundo con ráfaga de `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rps: number,
    private readonly burst: number,
    private readonly now: () => number = () => performance.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    if (rps <= 0 || burst < 1) throw new RangeError('rps > 0 y burst ≥ 1');
    this.tokens = burst;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rps);
    this.last = t;
  }

  /** Toma una ficha si hay; no espera. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Espera hasta que haya una ficha y la toma. */
  async take(signal?: AbortSignal): Promise<void> {
    while (!this.tryTake()) {
      signal?.throwIfAborted();
      await this.sleep(Math.ceil(((1 - this.tokens) / this.rps) * 1000));
    }
  }
}

export interface RetryOptions {
  /** Reintentos después del primer intento (§9: 3). */
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Si devuelve false, el error se propaga sin reintentar. */
  shouldRetry?: (error: unknown) => boolean;
  signal?: AbortSignal;
}

/** Retardo exponencial con jitter completo: aleatorio en [0, min(max, base·2^intento)]. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number) {
  return Math.round(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** Ejecuta `fn` con hasta `retries` reintentos exponenciales con jitter (§9). */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseMs = 500,
    maxMs = 30_000,
    random = Math.random,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    shouldRetry = () => true,
    signal,
  } = options;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error) || signal?.aborted) throw error;
      await sleep(backoffDelay(attempt, baseMs, maxMs, random));
    }
  }
}
