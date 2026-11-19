import { Redis } from 'ioredis';

/** Crea el cliente de Redis. Admite `redis://` y `rediss://` (TLS). */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}
