import { z } from 'zod';

const isoDate = z.iso.datetime({ offset: true });

/** Una oferta vigente de una variante en la ficha de producto (§7, H3). */
export const productOfferSchema = z.object({
  offer_id: z.uuid(),
  merchant: z.string(),
  merchant_name: z.string(),
  price: z.number().int(),
  list_price: z.number().int().nullable(),
  discount_pct: z.number().nullable(),
  /** Descuento validado con historial (§8.4, H5). Mientras tanto siempre `false`. */
  discount_validated: z.boolean(),
  availability: z.enum(['in_stock', 'out_of_stock', 'preorder', 'unknown']),
  in_stock: z.boolean(),
  condition: z.enum(['new', 'used', 'refurbished']),
  is_marketplace: z.boolean(),
  seller_name: z.string().nullable(),
  last_seen_at: isoDate,
  /** Visto hace entre 24 y 72 h: "puede haber cambiado" (§8.5). */
  stale: z.boolean(),
});

/** Atributos normalizados de una variante (§6). */
export const variantAttributesSchema = z.object({
  color: z.string().optional(),
  storage_gb: z.number().optional(),
  ram_gb: z.number().optional(),
  capacity_l: z.number().optional(),
  screen_in: z.number().optional(),
  weight_kg: z.number().optional(),
});

export const productVariantSchema = z.object({
  variant_id: z.uuid(),
  gtin: z.string().nullable(),
  attributes: variantAttributesSchema,
  image_url: z.string().nullable(),
  offer_count: z.number().int(),
  merchant_count: z.number().int(),
  /** Precio más bajo entre las ofertas compradas (en stock o sin confirmar); si no hay, el más bajo. */
  min_price: z.number().int(),
  /** Ofertas: primero las que se pueden comprar, por precio. */
  offers: z.array(productOfferSchema),
});

/**
 * GET /api/products/:id (§7, H3): ficha con sus variantes y las ofertas vigentes de cada una.
 * Solo las variantes con al menos una oferta vigente; sin ninguna, la ficha responde 404.
 */
export const productResponseSchema = z.object({
  product: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable(),
    model_number: z.string().nullable(),
    category: z.object({ slug: z.string(), name: z.string() }).nullable(),
    image_url: z.string().nullable(),
  }),
  /** Variantes, la de mejor precio primero. */
  variants: z.array(productVariantSchema),
  offer_count: z.number().int(),
  merchant_count: z.number().int(),
  min_price: z.number().int(),
  max_price: z.number().int(),
});

export type ProductOffer = z.infer<typeof productOfferSchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type VariantAttributesDto = z.infer<typeof variantAttributesSchema>;
