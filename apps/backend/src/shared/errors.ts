/** Errores de dominio (§13). El error handler único los traduce a respuestas HTTP. */
export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly code = 'not_found';
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly code = 'validation_error';
}

export class RateLimitError extends DomainError {
  readonly statusCode = 429;
  readonly code = 'rate_limited';
}

export class UnauthorizedError extends DomainError {
  readonly statusCode = 401;
  readonly code = 'unauthorized';
}
