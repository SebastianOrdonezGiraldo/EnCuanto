import type { FastifyInstance } from 'fastify';
import { getHealth, type HealthDeps } from './health.service';

export { getHealth, type HealthDeps } from './health.service';

/** GET /health: 200 si BD y Redis responden; 503 si alguna falla (para balanceadores y monitores). */
export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/health', async (_request, reply) => {
    const health = await getHealth(deps);
    return reply
      .status(health.status === 'ok' ? 200 : 503)
      .header('cache-control', 'no-store')
      .send(health);
  });
}
