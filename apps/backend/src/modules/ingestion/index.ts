/**
 * Módulo `ingestion` (§5): jobs de sync, sync runs y cuarentena.
 * Dueño de offers, price_history, provider_sync_runs y quarantined_records.
 */
export {
  bullConnection,
  createSyncQueue,
  createSyncWorker,
  enqueueSync,
  scheduleSyncs,
  SYNC_QUEUE,
  type SyncJobData,
} from './queue';
export { boundedPayload, recordHash, zodReason } from './quarantine';
export {
  CIRCUIT_FAILURES,
  CIRCUIT_PAUSE_MS,
  countOffersByMerchant,
  isCircuitOpen,
  latestRunByMerchant,
  listQuarantined,
  listSyncRuns,
  type SyncRunView,
} from './runs.service';
export {
  BATCH_SIZE,
  runSync,
  toOfferOrQuarantine,
  type SyncDeps,
  type SyncOptions,
  type SyncResult,
} from './sync.service';
