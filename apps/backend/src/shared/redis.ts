import { Redis } from 'ioredis';

/** Crea el cliente de Redis. Admite `redis://` y `rediss://` (TLS). */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Límites del driver para que una sonda colgada no se quede abierta.
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
}
