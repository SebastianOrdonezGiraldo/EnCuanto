import { EventEmitter } from 'node:events';
import type { Worker } from 'bullmq';
import { describe, expect, it } from 'vitest';
import {
  logMatchingWorkerEvents,
  sanitizedProcessor,
  type MatchingJobData,
} from '../../src/modules/matching/index';

describe('worker de matching', () => {
  it('un evento `error` (p. ej. Redis caído) se registra y no tumba el proceso', () => {
    const emitter = new EventEmitter();
    const errors: object[] = [];
    const warnings: object[] = [];
    logMatchingWorkerEvents(emitter as unknown as Worker<MatchingJobData>, {
      info: () => {},
      warn: (obj) => void warnings.push(obj),
      error: (obj) => void errors.push(obj),
    });
    const redisDown = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });
    // Sin listener, `emit('error')` lanza: es lo que termina el proceso en Node.
    expect(() => emitter.emit('error', redisDown)).not.toThrow();
    expect(errors).toEqual([{ err_type: 'Error', err_code: 'ECONNREFUSED' }]);
    // Tipo y código, nunca el mensaje (puede traer datos de la oferta).
    emitter.emit('failed', { id: '7' }, new Error('params: persona@example.test'));
    expect(warnings).toEqual([{ job_id: '7', err_type: 'Error' }]);
  });

  it('el error con el que falla un job (lo guarda BullMQ) no lleva el mensaje original', async () => {
    const job = sanitizedProcessor(async () => {
      throw Object.assign(new Error('Failed query: params: persona@example.test'), {
        name: 'DrizzleQueryError',
        cause: { code: '53100' },
      });
    });
    const error = (await job({ data: { trigger: 'admin' } } as never).catch((e) => e)) as Error;
    expect(error.name).toBe('MatchingJobError');
    expect(error.message).toBe('matching falló (DrizzleQueryError 53100)');
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });
});
