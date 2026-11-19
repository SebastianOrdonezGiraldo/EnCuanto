/** Lo mínimo de un logger pino que usan los servicios (así aceptan el de Fastify o el del worker). */
export interface Log {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLog: Log = { info: () => {}, warn: () => {}, error: () => {} };
