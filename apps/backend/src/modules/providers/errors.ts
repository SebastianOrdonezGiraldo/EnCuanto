import { FeedTooLargeError } from './adapters/fixture';
import { FeedHttpError } from './feed-source';
import { ProviderConfigError } from './registry';
import { FeedUrlError } from './url-guard';

/**
 * Mensaje de error apto para logs y para `provider_sync_runs.error_summary`. Solo se conservan
 * los mensajes de errores propios, que no llevan datos de la fuente. Los de los parsers
 * (JSON, CSV, XML) pueden citar bytes del feed, así que se cambian por un texto fijo.
 */
export function safeSyncErrorMessage(error: unknown): string {
  if (
    error instanceof FeedHttpError ||
    error instanceof FeedUrlError ||
    error instanceof FeedTooLargeError ||
    error instanceof ProviderConfigError
  ) {
    return error.message;
  }
  if (error instanceof Error && error.name === 'AbortError') return 'sync cancelado';
  const kind = error instanceof Error ? error.name : typeof error;
  return `error al leer o procesar el feed (${kind.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)})`;
}
