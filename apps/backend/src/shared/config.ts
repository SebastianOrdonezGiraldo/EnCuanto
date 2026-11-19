import { z } from 'zod';

const envSchema = z.object({
  // Por defecto producción: el modo desarrollo lo activa .env (NODE_ENV=development).
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Ingesta (H1).
  /** Directorio de los feeds `fixture:` (sintéticos). Por defecto, <raíz del repo>/fixtures. */
  FIXTURES_DIR: z.string().min(1).optional(),
  /** Cada cuántos minutos se sincroniza cada comerciante. 0 desactiva la programación. */
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10_080).default(360),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Cada cuántos segundos el worker reconcilia los syncs programados con los comerciantes. */
  SCHEDULE_RECONCILE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  /**
   * Token del admin mínimo (H1), hasta que haya usuarios (H4). Sin él, las rutas /api/admin
   * no se registran. Mínimo 32 caracteres.
   */
  ADMIN_TOKEN: z.string().min(32).optional(),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuración inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Valida las variables de entorno al arrancar (§13). Si falta una, lanza y la app no arranca. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Solo nombres de variable y motivo; nunca los valores (pueden ser secretos).
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
