import { createRequire } from 'node:module';
import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config';

const require = createRequire(import.meta.url);

/** pino-pretty es dependencia de desarrollo: solo se usa si está instalada. */
function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Opciones de pino (§13): JSON en producción, legible en desarrollo.
 * Se redactan cabeceras sensibles; nunca se loguean cuerpos de petición.
 */
export function loggerOptions(
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL'>,
  isPrettyAvailable: () => boolean = prettyAvailable,
): FastifyServerOptions['logger'] {
  const pretty = config.NODE_ENV === 'development' && isPrettyAvailable();
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redactado]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
