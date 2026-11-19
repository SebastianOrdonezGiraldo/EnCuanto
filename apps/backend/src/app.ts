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
    // request_id en cada log (§13). Lo genera siempre el servidor: no se acepta x-request-id
    // del cliente, para que nadie pueda inyectar datos arbitrarios en los logs.
    requestIdHeader: false,
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
