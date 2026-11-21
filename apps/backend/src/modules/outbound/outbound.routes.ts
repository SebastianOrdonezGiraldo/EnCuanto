import type { DbClient } from '@encuanto/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../shared/errors';
import { findOutboundTarget, recordClick } from './outbound.service';

export interface OutboundDeps {
  client: DbClient;
}

const offerIdSchema = z.uuid();

/**
 * GET /go/:offerId (CU‑4, §7): registra el clic y responde 302 a la tienda. El log de la
 * petición solo lleva el patrón `/go/:offerId`. Si registrar el clic falla, se redirige igual:
 * el usuario no debe quedarse sin ir a la tienda por un fallo de medición.
 */
export function registerOutboundRoutes(app: FastifyInstance, deps: OutboundDeps): void {
  app.get('/go/:offerId', async (request, reply) => {
    const id = offerIdSchema.safeParse((request.params as { offerId: string }).offerId);
    if (!id.success) throw new NotFoundError('Oferta no disponible');
    const target = await findOutboundTarget(deps.client, id.data);
    if (!target) throw new NotFoundError('Oferta no disponible');
    try {
      await recordClick(deps.client, target.offerId);
    } catch (err) {
      request.log.warn(
        { err: err instanceof Error ? err.message : 'error' },
        'go: clic no registrado',
      );
    }
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .redirect(target.url, 302);
  });
}
