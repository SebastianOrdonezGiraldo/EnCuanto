import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { TokenBucket, withRetry } from './rate-limit';
import { assertSafeFeedUrl, defaultLookup, FeedUrlError, type HostLookup } from './url-guard';

/** Redirecciones máximas al descargar un feed. */
export const MAX_REDIRECTS = 5;

export interface FeedSourceOptions {
  /** Directorio de los feeds `fixture:` (datos sintéticos). */
  fixturesDir: string;
  /** Inyectable en tests. */
  fetch?: typeof fetch;
  /** Resolución DNS para validar destinos (inyectable en tests). */
  lookup?: HostLookup;
  /** Tiempo máximo por petición HTTP. */
  timeoutMs?: number;
  /** Reintentos ante fallos de red, 429 y 5xx (§9: 3). */
  retries?: number;
  retryBaseMs?: number;
}

export class FeedHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(`el feed respondió HTTP ${status}`);
    this.name = 'FeedHttpError';
  }
}

/** Ruta absoluta de un `fixture:<ruta>`, sin permitir salir del directorio de fixtures. */
export function resolveFixturePath(location: string, fixturesDir: string): string {
  const relative = location.slice('fixture:'.length);
  const root = path.resolve(fixturesDir);
  const resolved = path.resolve(root, ...relative.split('/'));
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('ubicación de fixture fuera del directorio de fixtures');
  }
  return resolved;
}

/**
 * Abre un feed como flujo de bytes. `fixture:` lee un archivo local; `https:` descarga con
 * límite de tiempo, token bucket y reintentos exponenciales con jitter (§9).
 * Nunca se registra la URL (puede llevar el token del programa de afiliados).
 */
export class FeedSource {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: FeedSourceOptions,
    private readonly bucket: TokenBucket = new TokenBucket(1, 1),
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async open(location: string, signal: AbortSignal): Promise<Readable> {
    if (location.startsWith('fixture:')) {
      return createReadStream(resolveFixturePath(location, this.options.fixturesDir));
    }
    const response = await this.request(location, 'GET', signal);
    if (!response.body) throw new Error('el feed respondió sin cuerpo');
    return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  }

  async check(location: string, signal: AbortSignal): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (location.startsWith('fixture:')) {
        await access(resolveFixturePath(location, this.options.fixturesDir));
      } else {
        const response = await this.request(location, 'HEAD', signal);
        await response.body?.cancel();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'error desconocido' };
    }
  }

  /**
   * Las redirecciones se siguen a mano para validar cada destino con `assertSafeFeedUrl`:
   * un feed comprometido no puede llevar al worker a http, a la red interna ni a metadatos.
   */
  private async fetchFollowing(
    url: string,
    method: 'GET' | 'HEAD',
    signal: AbortSignal,
  ): Promise<Response> {
    const lookup = this.options.lookup ?? defaultLookup;
    let current = url;
    for (let hop = 0; ; hop++) {
      await assertSafeFeedUrl(current, lookup);
      const response = await this.fetchImpl(current, {
        method,
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs ?? 60_000)]),
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) return response;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new FeedUrlError('demasiadas redirecciones');
      current = new URL(location, current).toString();
    }
  }

  private request(url: string, method: 'GET' | 'HEAD', signal: AbortSignal): Promise<Response> {
    return withRetry(
      async () => {
        await this.bucket.take(signal);
        const response = await this.fetchFollowing(url, method, signal);
        if (!response.ok) {
          await response.body?.cancel();
          throw new FeedHttpError(
            response.status,
            response.status === 429 || response.status >= 500,
          );
        }
        return response;
      },
      {
        retries: this.options.retries ?? 3,
        baseMs: this.options.retryBaseMs ?? 1000,
        signal,
        shouldRetry: (error) =>
          !(error instanceof FeedUrlError) &&
          (!(error instanceof FeedHttpError) || error.retryable),
      },
    );
  }
}
