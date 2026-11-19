import { safeSyncErrorMessage } from '../providers/index';
import { DomainError } from '../../shared/errors';

/**
 * Error con el que falla un sync hacia fuera (BullMQ, logs del worker). Solo lleva el mensaje
 * saneado, sin `cause` ni el error original: así nada serializa bytes del feed.
 */
export class SyncFailedError extends Error {
  constructor(
    message: string,
    public readonly runId: string,
  ) {
    super(message);
    this.name = 'SyncFailedError';
  }
}

/** Mensaje apto para logs de cualquier error que salga de un job de sync. */
export function safeJobErrorMessage(error: unknown): string {
  if (error instanceof SyncFailedError || error instanceof DomainError) return error.message;
  return safeSyncErrorMessage(error);
}
