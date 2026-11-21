import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAdminRoutes, type AdminDeps } from './modules/admin/index';
import { registerHealthRoutes, type HealthDeps } from './modules/health/index';
import { registerOutboundRoutes, type OutboundDeps } from './modules/outbound/index';
import { registerSearchRoutes, type SearchService } from './modules/search/index';
import { registerErrorHandler } from './shared/error-handler';

export interface AppDeps {
  health: HealthDeps;
  /** Admin mínimo (H1). Sin él (sin ADMIN_TOKEN), las rutas /api/admin no existen. */
  admin?: AdminDeps;
  /** Búsqueda y navegación pública (H2). */
  search?: SearchService;
  /** `/go/:offerId` (H2). */
  outbound?: OutboundDeps;
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
  if (deps.admin) registerAdminRoutes(app, deps.admin);
  if (deps.search) registerSearchRoutes(app, deps.search);
  if (deps.outbound) registerOutboundRoutes(app, deps.outbound);

  return app;
}
