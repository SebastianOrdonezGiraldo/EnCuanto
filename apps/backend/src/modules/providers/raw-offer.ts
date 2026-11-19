import { z } from 'zod';

/** Texto opcional: cadenas vacías o solo espacios cuentan como ausentes. */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).nullish(),
  );

const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);

/** Precio tal como llega: número o texto ("$1.899.900", "1899900.00 COP"). Lo interpreta `normalization`. */
const priceInput = z.union([z.number(), z.string().trim().min(1).max(40)]);

const CONDITION: Record<string, 'new' | 'used' | 'refurbished'> = {
  new: 'new',
  nuevo: 'new',
  nueva: 'new',
  used: 'used',
  usado: 'used',
  usada: 'used',
  refurbished: 'refurbished',
  reacondicionado: 'refurbished',
  reacondicionada: 'refurbished',
};

const AVAILABILITY: Record<string, 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown'> = {
  in_stock: 'in_stock',
  'in stock': 'in_stock',
  disponible: 'in_stock',
  'en stock': 'in_stock',
  out_of_stock: 'out_of_stock',
  'out of stock': 'out_of_stock',
  agotado: 'out_of_stock',
  'sin stock': 'out_of_stock',
  preorder: 'preorder',
  backorder: 'preorder',
  preventa: 'preorder',
};

/**
 * Traduce el valor de la fuente (en inglés o español). Vacío → `empty`. Desconocido → `unknown`
 * si se da; si no, se deja tal cual para que el enum lo rechace y el registro vaya a cuarentena.
 */
const lookup =
  <T extends string>(table: Record<string, T>, empty: T, unknown?: T) =>
  (v: unknown): unknown => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return empty;
    if (typeof v !== 'string') return v;
    const key = v.trim().toLowerCase().replace(/\s+/g, ' ');
    return table[key] ?? unknown ?? key;
  };

/**
 * Oferta tal como la entrega un adaptador (§9), antes de normalizar. Se valida con Zod en la
 * ingesta: lo que no pasa va a `quarantined_records`, nunca a `offers`.
 */
export const rawOfferSchema = z.object({
  externalId: z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : v),
    z.string().trim().min(1).max(200),
  ),
  title: z.string().trim().min(1).max(500),
  url: httpUrl,
  imageUrl: z.preprocess((v) => (v === '' ? undefined : v), httpUrl.nullish()),
  price: priceInput,
  listPrice: z.preprocess((v) => (v === '' ? undefined : v), priceInput.nullish()),
  currency: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toUpperCase() : 'COP'),
    z.literal('COP'),
  ),
  gtin: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.union([z.string().max(32), z.number()]).nullish(),
  ),
  brand: optionalText(100),
  category: optionalText(200),
  sellerName: optionalText(200),
  isMarketplace: z.preprocess(
    (v) =>
      typeof v === 'string' ? ['true', '1', 'si', 'sí', 'yes'].includes(v.trim().toLowerCase()) : v,
    z.boolean().default(false),
  ),
  condition: z.preprocess(lookup(CONDITION, 'new'), z.enum(['new', 'used', 'refurbished'])),
  availability: z.preprocess(
    lookup(AVAILABILITY, 'unknown', 'unknown'),
    z.enum(['in_stock', 'out_of_stock', 'preorder', 'unknown']),
  ),
});

export type RawOffer = z.infer<typeof rawOfferSchema>;
/** Registro que produce un adaptador: campos de `RawOffer` aún sin validar. */
export type RawOfferInput = Record<string, unknown>;
