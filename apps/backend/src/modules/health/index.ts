import type { FastifyInstance } from 'fastify';
import { getHealth, type HealthDeps } from './health.service';

export { getHealth, type HealthDeps } from './health.service';

/** GET /health: 200 si BD y Redis responden; 503 si alguna falla (para balanceadores y monitores). */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  // Una sola comprobación en vuelo: las peticiones concurrentes comparten el resultado,
  // así un pico de /health durante una caída no acumula sondas contra BD y Redis.
  let inFlight: ReturnType<typeof getHealth> | undefined;

  app.get('/health', async (_request, reply) => {
    inFlight ??= getHealth(deps).finally(() => {
      inFlight = undefined;
    });
    const health = await inFlight;
    return reply
      .status(health.status === 'ok' ? 200 : 503)
      .header('cache-control', 'no-store')
      .send(health);
  });
}
