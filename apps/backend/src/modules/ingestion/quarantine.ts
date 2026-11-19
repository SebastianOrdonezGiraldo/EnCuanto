import { createHash } from 'node:crypto';
import type { z } from 'zod';

const MAX_STRING = 2000;
const MAX_KEYS = 60;

/**
 * Copia acotada del registro para guardarlo en cuarentena: textos de hasta 2.000 caracteres,
 * hasta 60 campos y 3 niveles. Evita que un feed roto llene la BD.
 */
export function boundedPayload(value: unknown, depth = 0): unknown {
  if (typeof value === 'string')
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' || typeof value === 'boolean' ? value : (value ?? null);
  }
  if (depth >= 3) return '[anidado]';
  if (Array.isArray(value))
    return value.slice(0, MAX_KEYS).map((v) => boundedPayload(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort().slice(0, MAX_KEYS)) {
    out[key] = boundedPayload((value as Record<string, unknown>)[key], depth + 1);
  }
  return out;
}

/** sha256 del payload acotado (claves ordenadas): mismo registro inválido → mismo hash. */
export function recordHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Motivo legible y sin valores de la fuente: `invalid:price,url`. */
export function zodReason(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((i) => String(i.path[0] ?? 'registro')))].sort();
  return `invalid:${fields.join(',')}`;
}
