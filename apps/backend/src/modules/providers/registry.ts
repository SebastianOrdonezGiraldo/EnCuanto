import { CsvFeedAdapter } from './adapters/csv';
import { FixtureAdapter } from './adapters/fixture';
import { GoogleMerchantFeedAdapter } from './adapters/google-merchant';
import { providerConfigSchema } from './config';
import { FeedSource, type FeedSourceOptions } from './feed-source';
import { TokenBucket } from './rate-limit';
import type { ProviderAdapter, SourceType } from './types';

export class ProviderConfigError extends Error {
  constructor(merchantSlug: string, detail: string) {
    super(`configuración de proveedor inválida para "${merchantSlug}": ${detail}`);
    this.name = 'ProviderConfigError';
  }
}

export interface MerchantSource {
  slug: string;
  sourceType: SourceType;
  providerConfig: unknown;
}

/**
 * Registro de adaptadores: crea el adaptador de un comerciante a partir de su `provider_config`.
 * Cada adaptador tiene su propio token bucket (§9: límite por comerciante).
 */
export function createAdapter(
  merchant: MerchantSource,
  options: FeedSourceOptions,
): ProviderAdapter {
  const parsed = providerConfigSchema.safeParse(merchant.providerConfig);
  if (!parsed.success) {
    throw new ProviderConfigError(
      merchant.slug,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; '),
    );
  }
  const config = parsed.data;
  const source = new FeedSource(options, new TokenBucket(1, 1));
  switch (config.kind) {
    case 'fixture':
      return new FixtureAdapter(merchant.slug, merchant.sourceType, config.location, source);
    case 'csv':
      return new CsvFeedAdapter(
        merchant.slug,
        merchant.sourceType,
        config.location,
        config.delimiter,
        config.columns,
        source,
      );
    case 'google_merchant':
      return new GoogleMerchantFeedAdapter(
        merchant.slug,
        merchant.sourceType,
        config.location,
        config.format,
        source,
      );
  }
}
