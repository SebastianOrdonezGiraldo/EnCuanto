import { EventEmitter } from 'node:events';
import type { Worker } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { logMatchingWorkerEvents, type MatchingJobData } from '../../src/modules/matching/index';

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
    // Sin listener, `emit('error')` lanza: es lo que termina el proceso en Node.
    expect(() =>
      emitter.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379')),
    ).not.toThrow();
    expect(errors).toEqual([{ err: 'connect ECONNREFUSED 127.0.0.1:6379' }]);
    emitter.emit('failed', { id: '7' }, new Error('falló'));
    expect(warnings).toEqual([{ job_id: '7', err: 'falló' }]);
  });
});
