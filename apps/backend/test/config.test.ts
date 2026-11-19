import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/shared/config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('aplica valores por defecto', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.NODE_ENV).toBe('development');
  });

  it('respeta PORT de la plataforma', () => {
    expect(loadConfig({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('acepta URLs con TLS (rediss://, postgresql://)', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://u:p@db.example.com/db?sslmode=require',
      REDIS_URL: 'rediss://default:x@cache.example.com:6380',
    });
    expect(config.REDIS_URL.startsWith('rediss://')).toBe(true);
  });

  it('no arranca si falta una variable', () => {
    expect(() => loadConfig({ REDIS_URL: base.REDIS_URL })).toThrow(ConfigError);
  });

  it('no incluye valores en el mensaje de error', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://secreto@host/db', REDIS_URL: base.REDIS_URL });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain('secreto');
    }
  });
});
