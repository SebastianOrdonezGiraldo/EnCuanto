import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerHealthRoutes, type HealthDeps } from './modules/health/index';
import { registerErrorHandler } from './shared/error-handler';

export interface AppDeps {
  health: HealthDeps;
}

/** Construye la app sin escuchar en ningún puerto, para poder probarla con `inject`. */
export function buildApp(
  deps: AppDeps,
  options: Pick<FastifyServerOptions, 'logger'> = {},
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // request_id en cada log (§13). Se respeta x-request-id si viene de un proxy.
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, deps.health);

  return app;
}
