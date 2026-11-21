import { createHash } from 'node:crypto';
import { CATALOG_VERSION_KEY } from '../../shared/catalog-version';
import type { Log } from '../../shared/log';
import type { FacetCounts, RankedItem } from './rank';

/** Lo que usa la caché de un cliente Redis (ioredis lo cumple; los tests pasan un doble). */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/** Un producto del conjunto ordenado, compacto: [id, score, oferta, min, max, ofertas, tiendas]. */
type Tuple = [string, number, string, number, number, number, number];

/** Valor cacheado (§8.6): el conjunto completo de IDs y scores, las facetas y el total. */
export interface CachedListing {
  generatedAt: string;
  /**
   * Hasta cuándo es correcto el conjunto: la primera caducidad (§8.5) de una oferta con la que
   * se calculó. Después, la mejor oferta, los precios, el orden y las facetas podrían cambiar
   * sin que suba la versión de catálogo. `null` si no usó ninguna oferta.
   */
  validUntil: string | null;
  items: RankedItem[];
  facets: FacetCounts;
}

interface Stored {
  g: string;
  u: string | null;
  i: Tuple[];
  f: FacetCounts;
}

/**
 * Clave de §8.6: `<prefijo>:v{catalogVersion}:{sha1(consulta normalizada + filtros + orden)}`.
 * La página no forma parte de la clave: se recorta del conjunto, así que cambiar de página no
 * recalcula. Subir `catalogVersion` (al terminar un sync con cambios) invalida todas las claves.
 */
export function cacheKey(prefix: 'search' | 'browse', version: string, identity: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(identity)).digest('hex');
  return `${prefix}:v${version}:${hash}`;
}

export class ListingCache {
  constructor(
    private readonly store: CacheStore | null,
    private readonly ttlSeconds: number,
    private readonly log: Log,
  ) {}

  /** Versión de catálogo actual; `null` si Redis no responde (entonces no se usa la caché). */
  async version(): Promise<string | null> {
    if (!this.store) return null;
    try {
      return (await this.store.get(CATALOG_VERSION_KEY)) ?? '0';
    } catch (err) {
      this.warn(err);
      return null;
    }
  }

  /** Conjunto cacheado, o null si no está o ya no es válido en `now`. */
  async get(key: string, now: Date): Promise<CachedListing | null> {
    if (!this.store) return null;
    try {
      const raw = await this.store.get(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as Stored;
      if (s.u !== null && Date.parse(s.u) <= now.getTime()) return null;
      return {
        generatedAt: s.g,
        validUntil: s.u,
        facets: s.f,
        items: s.i.map(
          ([productId, score, bestOfferId, minPrice, maxPrice, offerCount, merchantCount]) => ({
            productId,
            score,
            bestOfferId,
            minPrice,
            maxPrice,
            offerCount,
            merchantCount,
          }),
        ),
      };
    } catch (err) {
      this.warn(err);
      return null;
    }
  }

  /**
   * Guarda el conjunto con el TTL configurado, acortado hasta `validUntil`. Si ya no le queda
   * ni un segundo de validez, no lo guarda.
   */
  async set(key: string, value: CachedListing, now: Date): Promise<void> {
    if (!this.store) return;
    const ttl =
      value.validUntil === null
        ? this.ttlSeconds
        : Math.min(
            this.ttlSeconds,
            Math.floor((Date.parse(value.validUntil) - now.getTime()) / 1000),
          );
    if (ttl < 1) return;
    const stored: Stored = {
      g: value.generatedAt,
      u: value.validUntil,
      f: value.facets,
      i: value.items.map((r) => [
        r.productId,
        r.score,
        r.bestOfferId,
        r.minPrice,
        r.maxPrice,
        r.offerCount,
        r.merchantCount,
      ]),
    };
    try {
      await this.store.set(key, JSON.stringify(stored), 'EX', ttl);
    } catch (err) {
      this.warn(err);
    }
  }

  /** Solo el mensaje del error: nunca la clave ni la consulta. */
  private warn(err: unknown): void {
    this.log.warn(
      { err: err instanceof Error ? err.message : 'error' },
      'search: caché no disponible',
    );
  }
}
