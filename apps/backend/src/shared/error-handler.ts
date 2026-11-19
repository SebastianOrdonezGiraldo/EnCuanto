import type { ErrorResponse } from '@encuanto/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { DomainError } from './errors';

/** Único punto que convierte errores en respuestas con el formato uniforme de §7. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | DomainError | Error, request, reply) => {
    if (error instanceof DomainError) {
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      return reply.status(error.statusCode).send(body);
    }

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'error no controlado');
      const body: ErrorResponse = { error: { code: 'internal_error', message: 'Error interno' } };
      return reply.status(500).send(body);
    }

    const body: ErrorResponse = {
      error: {
        code: 'code' in error && error.code ? String(error.code).toLowerCase() : 'bad_request',
        message: error.message,
      },
    };
    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { error: { code: 'not_found', message: 'Ruta no encontrada' } };
    return reply.status(404).send(body);
  });
}
