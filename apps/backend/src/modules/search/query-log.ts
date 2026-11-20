import { searchQueries, type Database } from '@encuanto/db';
import type { Log } from '../../shared/log';
import { normalizeText } from '../normalization/index';

const EMAIL = /[^\s@]+@[^\s@]+/g;
/** 7 o más dígitos seguidos (teléfonos, cédulas): no son búsquedas de producto útiles. */
const LONG_NUMBER = /\d{7,}/g;

/**
 * Consulta apta para `search_queries` (§4.3, §6): normalizada y sin correos ni números largos
 * que puedan identificar a alguien. Se limpia la consulta original, antes de normalizar, porque
 * la normalización quitaría la "@" y el correo ya no se reconocería.
 */
export function scrubQuery(raw: string): string {
  const cleaned = raw.replace(EMAIL, ' [email] ').replace(LONG_NUMBER, ' [numero] ');
  return normalizeText(cleaned)
    .replace(/[^a-z0-9[\] ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export interface QueryLogEntry {
  /** Consulta tal como la escribió el usuario: se limpia aquí antes de guardarla. */
  query: string;
  filters: Record<string, unknown>;
  resultsCount: number;
  latencyMs: number;
}

/** Registra la consulta sin bloquear la respuesta; un fallo solo se loguea (sin la consulta). */
export function logSearchQuery(db: Database, log: Log, entry: QueryLogEntry): void {
  void db
    .insert(searchQueries)
    .values({
      qNormalized: scrubQuery(entry.query),
      filters: entry.filters,
      resultsCount: entry.resultsCount,
      latencyMs: Math.round(entry.latencyMs),
    })
    .catch((err: unknown) =>
      log.warn(
        { err: err instanceof Error ? err.message : 'error' },
        'search: no se registró la consulta',
      ),
    );
}
