import { describe, expect, it } from 'vitest';
import { safeErrorInfo, safeErrorMessage, safeStack } from '../src/shared/safe-error';

describe('errores aptos para logs (§4)', () => {
  const secret = 'https://prueba.example/x?token=secreto_sintetico&email=persona@example.test';
  const dbError = Object.assign(new Error(`Failed query: insert ... params: ${secret}`), {
    name: 'DrizzleQueryError',
    cause: Object.assign(new Error(`detail: ${secret}`), { code: '23505' }),
  });

  it('solo tipo y código (SQLSTATE o de sistema), nunca el mensaje ni la causa', () => {
    expect(safeErrorInfo(dbError)).toEqual({ err_type: 'DrizzleQueryError', err_code: '23505' });
    expect(safeErrorMessage(dbError)).toBe('DrizzleQueryError 23505');
    const net = Object.assign(new Error(`connect ${secret}`), { code: 'ECONNREFUSED' });
    expect(safeErrorInfo(net)).toEqual({ err_type: 'Error', err_code: 'ECONNREFUSED' });
    // Un "código" con datos no se toma.
    expect(safeErrorInfo(Object.assign(new Error('x'), { code: secret }))).toEqual({
      err_type: 'Error',
    });
  });

  it('la pila sin la primera línea (que repite el mensaje)', () => {
    const stack = safeStack(dbError)!;
    expect(stack).toMatch(/^\s+at /);
    expect(stack).not.toContain('secreto_sintetico');
  });
});
