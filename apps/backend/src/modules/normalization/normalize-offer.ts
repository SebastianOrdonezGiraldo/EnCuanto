import type { VariantAttributes } from '@encuanto/db';
import { extractAttributes } from './attributes';
import { normalizeBrand, type BrandDictionary } from './brand';
import { normalizeGtin } from './gtin';
import { extractModelNumber } from './model';
import { normalizePrices } from './price';
import { normalizeText } from './text';

export interface OfferToNormalize {
  title: string;
  brand?: string | null;
  gtin?: string | number | null;
  price: string | number;
  listPrice?: string | number | null;
}

export interface NormalizedOffer {
  titleNormalized: string;
  brand: string | null;
  modelNumber: string | null;
  gtin: string | null;
  attributes: VariantAttributes;
  price: number;
  listPrice: number | null;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedOffer }
  | { ok: false; reason: 'invalid_price' | 'empty_title' };

/**
 * Aplica todas las reglas de §8.1 a una oferta. Un GTIN inválido se descarta (queda `null`);
 * un precio inválido o un título vacío hacen que la oferta vaya a cuarentena.
 */
export function normalizeOffer(input: OfferToNormalize, brands: BrandDictionary): NormalizeResult {
  const titleNormalized = normalizeText(input.title);
  if (!titleNormalized) return { ok: false, reason: 'empty_title' };
  const prices = normalizePrices(input.price, input.listPrice);
  if (!prices) return { ok: false, reason: 'invalid_price' };

  const { attributes, matched } = extractAttributes(titleNormalized);
  return {
    ok: true,
    value: {
      titleNormalized,
      brand: normalizeBrand(input.brand, titleNormalized, brands),
      modelNumber: extractModelNumber(titleNormalized, matched),
      gtin: normalizeGtin(input.gtin),
      attributes,
      price: prices.price,
      listPrice: prices.listPrice,
    },
  };
}
