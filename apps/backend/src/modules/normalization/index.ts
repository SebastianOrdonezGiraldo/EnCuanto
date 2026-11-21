/** Módulo `normalization` (§8.1): funciones puras, sin BD ni red. */
export { ACCESSORY_TERMS } from './accessory';
export { extractAttributes, type ExtractedAttributes } from './attributes';
export {
  BRAND_ALIASES,
  brandKey,
  buildBrandDictionary,
  normalizeBrand,
  type BrandDictionary,
} from './brand';
export { checkDigit, normalizeGtin } from './gtin';
export { extractModelNumber, isSpecToken } from './model';
export {
  normalizeOffer,
  type NormalizeResult,
  type NormalizedOffer,
  type OfferToNormalize,
} from './normalize-offer';
export { MAX_PRICE_COP, normalizePrices, parsePriceCop } from './price';
export { normalizeText } from './text';
