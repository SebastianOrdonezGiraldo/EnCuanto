import { listingQuerySchema, merchantSlugSchema, searchQuerySchema } from '@encuanto/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../shared/errors';
import { parseOrThrow } from '../../shared/validation';
import type { SearchService } from './search.service';

/** Slug de categoría: mismo formato que genera `slugify`. */
const categorySlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

/** Respuestas públicas y cacheables poco tiempo: los precios cambian con cada sync. */
const PUBLIC_CACHE = 'public, max-age=60';

/**
 * Rutas públicas de búsqueda y navegación (§7, H2). Los logs de Fastify solo registran el patrón
 * de la ruta (`/api/search`), nunca la consulta.
 */
export function registerSearchRoutes(app: FastifyInstance, service: SearchService): void {
  app.get('/api/search', async (request, reply) => {
    const query = parseOrThrow(searchQuerySchema, request.query);
    reply.header('cache-control', PUBLIC_CACHE);
    return service.search(query);
  });

  app.get('/api/categories', async (_request, reply) => {
    reply.header('cache-control', PUBLIC_CACHE);
    return service.categories();
  });

  app.get('/api/categories/:slug', async (request, reply) => {
    const slug = categorySlugSchema.safeParse((request.params as { slug: string }).slug);
    if (!slug.success) throw new NotFoundError('Categoría no encontrada');
    const query = parseOrThrow(listingQuerySchema, request.query);
    reply.header('cache-control', PUBLIC_CACHE);
    return service.browseCategory(slug.data, query);
  });

  app.get('/api/merchants', async (_request, reply) => {
    reply.header('cache-control', PUBLIC_CACHE);
    return service.merchants();
  });

  app.get('/api/merchants/:slug', async (request, reply) => {
    const slug = merchantSlugSchema.safeParse((request.params as { slug: string }).slug);
    if (!slug.success) throw new NotFoundError('Tienda no encontrada');
    const query = parseOrThrow(listingQuerySchema, request.query);
    reply.header('cache-control', PUBLIC_CACHE);
    return service.browseMerchant(slug.data, query);
  });
}
