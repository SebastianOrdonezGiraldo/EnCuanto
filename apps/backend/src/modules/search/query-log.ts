import { searchQueries, type Database } from '@encuanto/db';
import type { Log } from '../../shared/log';
import { normalizeText } from '../normalization/index';

const EMAIL = /[^\s@]+@[^\s@]+/g;
/**
 * Secuencia de dígitos con prefijo y separadores de contacto (`+`, espacios, puntos, guiones,
 * paréntesis, barras): "+57 300 123 4567", "(601) 555-1234", "300.123.4567".
 */
const NUMBER_RUN = /\+?[(\d][\d\s().\-/]*\d/g;
/** Con 7 o más dígitos es un teléfono o un documento, no una búsqueda de producto útil. */
const MIN_IDENTIFYING_DIGITS = 7;

function redactNumbers(text: string): string {
  return text.replace(NUMBER_RUN, (run) =>
    (run.match(/\d/g)?.length ?? 0) >= MIN_IDENTIFYING_DIGITS ? ' [numero] ' : run,
  );
}

/**
 * Consulta apta para `search_queries` (§4.3, §6): normalizada y sin correos ni números que
 * puedan identificar a alguien (teléfonos y documentos, también con prefijo y separadores).
 * Se limpia la consulta original, antes de normalizar, porque la normalización quitaría la "@"
 * y los separadores; después se repasa el resultado normalizado por si quedó algún número
 * reconstruible (por ejemplo con separadores Unicode que la normalización convierte en espacio).
 */
export function scrubQuery(raw: string): string {
  const cleaned = redactNumbers(raw.replace(EMAIL, ' [email] '));
  const normalized = normalizeText(cleaned)
    .replace(/[^a-z0-9[\] ]+/g, ' ')
    .replace(/\s+/g, ' ');
  return redactNumbers(normalized).replace(/\s+/g, ' ').trim().slice(0, 100);
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
