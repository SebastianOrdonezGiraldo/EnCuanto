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
  items: RankedItem[];
  facets: FacetCounts;
}

interface Stored {
  g: string;
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

  async get(key: string): Promise<CachedListing | null> {
    if (!this.store) return null;
    try {
      const raw = await this.store.get(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as Stored;
      return {
        generatedAt: s.g,
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

  async set(key: string, value: CachedListing): Promise<void> {
    if (!this.store) return;
    const stored: Stored = {
      g: value.generatedAt,
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
      await this.store.set(key, JSON.stringify(stored), 'EX', this.ttlSeconds);
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
