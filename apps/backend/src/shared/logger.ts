import { createRequire } from 'node:module';
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
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
 * Ruta que se registra en los logs: el patrón de la ruta (`/go/:offerId`) si existe y,
 * si no, el path sin query. Nunca la query, que puede llevar emails, tokens o búsquedas (§4.3).
 */
export function loggablePath(request: Pick<FastifyRequest, 'url' | 'routeOptions'>): string {
  const pattern = request.routeOptions?.url;
  if (pattern) return pattern;
  const path = request.url.split('?', 1)[0] ?? '/';
  return path.split('#', 1)[0] ?? '/';
}

/**
 * Serializadores de pino: deciden qué se escribe de cada petición y respuesta.
 * Lista blanca: método y ruta, y el código de estado. Sin IP, puerto, cabeceras ni query.
 */
export const serializers = {
  req: (request: FastifyRequest) => ({ method: request.method, url: loggablePath(request) }),
  res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
};

export interface LoggerOverrides {
  isPrettyAvailable?: () => boolean;
  /** Destino alternativo (tests). */
  stream?: { write(line: string): void };
}

/**
 * Opciones de pino (§13): JSON en producción, legible en desarrollo.
 * Nunca se loguean cuerpos, cabeceras, query ni IP.
 */
export function loggerOptions(
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL'>,
  overrides: LoggerOverrides = {},
): FastifyServerOptions['logger'] {
  const { isPrettyAvailable = prettyAvailable, stream } = overrides;
  const pretty = !stream && config.NODE_ENV === 'development' && isPrettyAvailable();
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    serializers,
    // Defensa adicional si algún log futuro incluye cabeceras explícitamente.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[redactado]',
    },
    ...(stream ? { stream } : {}),
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}
