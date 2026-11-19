import type { RawOffer, RawOfferInput } from './raw-offer';

export type SourceType = 'affiliate_feed' | 'official_api' | 'partner_feed' | 'manual';

export interface SyncContext {
  merchantSlug: string;
  /** Se aborta al apagar el worker o al cancelar el job. */
  signal: AbortSignal;
  /** Cursor de sync incremental (las fuentes de feed hacen siempre sync completa). */
  cursor?: string;
}

/** Contrato de los adaptadores de fuentes autorizadas (§9). */
export interface ProviderAdapter {
  readonly merchantSlug: string;
  readonly sourceType: SourceType;
  readonly limits: { rps: number; burst: number; dailyQuota?: number };
  /** Registros sin validar: la ingesta los valida con `rawOfferSchema` y los normaliza. */
  sync(ctx: SyncContext): AsyncIterable<RawOfferInput>;
  refresh?(externalIds: string[], ctx: SyncContext): Promise<RawOffer[]>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
