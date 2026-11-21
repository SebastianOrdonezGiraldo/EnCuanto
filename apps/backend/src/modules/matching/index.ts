/**
 * Módulo `matching` (§8.2, H3): empareja ofertas con variantes del catálogo. Escribe
 * `offers.variant_id`, `match_status`, `match_confidence` y `match_level`, y es dueño de
 * `match_reviews` (cola de revisión manual).
 */
export { assignVariants, type VariantAssignment } from './assign.service';
export { candidatesInMemory, MAX_SIMILAR_PRODUCTS, RECALL_SIMILARITY } from './candidates';
export { findCandidates } from './candidates.repository';
export {
  flushCatalogInvalidation,
  MATCHING_LOCK,
  runMatching,
  type MatchingDeps,
  type MatchingResult,
} from './match.service';
export {
  createMatchingQueue,
  createMatchingWorker,
  enqueueMatching,
  logMatchingWorkerEvents,
  MatchingJobError,
  sanitizedProcessor,
  MATCHING_QUEUE,
  type MatchingJobData,
} from './queue';
export {
  listReviews,
  resolveReview,
  type ReviewDecision,
  type ReviewView,
} from './reviews.service';
export {
  AUTO_SIMILARITY,
  chooseVariant,
  compatible,
  CONFIDENCE,
  decideMatch,
  MODEL_MIN_SIMILARITY,
  modelConflict,
  REVIEW_SIMILARITY,
  type CandidateProduct,
  type CandidateVariant,
  type MatchCandidates,
  type MatchDecision,
  type MatchOffer,
  type ReviewReason,
} from './rules';
export {
  categoryName,
  displayName,
  identityTokens,
  looksLikeAccessory,
  looksLikeBundle,
  modelKey,
  prepareTitle,
  type PreparedTitle,
} from './title';
export { similarity, trigrams } from './trigram';
