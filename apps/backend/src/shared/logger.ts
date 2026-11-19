import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config';

/**
 * Opciones de pino (§13): JSON en producción, legible en desarrollo.
 * Se redactan cabeceras sensibles; nunca se loguean cuerpos de petición.
 */
export function loggerOptions(
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL'>,
): FastifyServerOptions['logger'] {
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redactado]',
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
