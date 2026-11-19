/** Módulo `providers` (§9): adaptadores de fuentes autorizadas, registro y límites. */
export { CsvFeedAdapter, readDelimited } from './adapters/csv';
export { FixtureAdapter } from './adapters/fixture';
export {
  GoogleMerchantFeedAdapter,
  mapGoogleRecord,
  readGoogleXml,
} from './adapters/google-merchant';
export {
  feedLocationSchema,
  providerConfigSchema,
  type CsvColumns,
  type ProviderConfig,
} from './config';
export {
  FeedHttpError,
  FeedSource,
  MAX_REDIRECTS,
  resolveFixturePath,
  type FeedSourceOptions,
} from './feed-source';
export { TokenBucket, backoffDelay, withRetry, type RetryOptions } from './rate-limit';
export { rawOfferSchema, type RawOffer, type RawOfferInput } from './raw-offer';
export { assertSafeFeedUrl, FeedUrlError, isPublicAddress, type HostLookup } from './url-guard';
export { ProviderConfigError, createAdapter, type MerchantSource } from './registry';
export type { ProviderAdapter, SourceType, SyncContext } from './types';
