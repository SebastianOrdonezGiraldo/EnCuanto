import type { z } from 'zod';
import { ValidationError } from './errors';

/**
 * Valida con Zod en el borde (§4.5). Los detalles solo dicen qué campo falla y por qué:
 * nunca devuelven el valor recibido.
 */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Parámetros inválidos', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}
