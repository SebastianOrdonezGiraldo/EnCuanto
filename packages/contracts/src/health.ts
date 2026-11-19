import { z } from 'zod';

export const dependencyCheckSchema = z.object({
  status: z.enum(['ok', 'error']),
  latency_ms: z.number().nonnegative(),
  error: z.string().optional(),
});

/** Respuesta de GET /health. `status` es "ok" solo si todas las dependencias están bien. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptime_s: z.number().nonnegative(),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});

export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
