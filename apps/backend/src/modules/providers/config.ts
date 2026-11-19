import { z } from 'zod';

/**
 * Ubicación de un feed: `fixture:<ruta>` (archivo bajo el directorio de fixtures, solo datos
 * sintéticos) o una URL https entregada por el comerciante o el programa de afiliados.
 */
export const feedLocationSchema = z.union([
  z
    .string()
    .regex(/^fixture:[a-z0-9][a-z0-9._/-]*$/i, 'fixture: solo admite letras, números, . _ / -')
    .refine((v) => !v.split('/').includes('..'), 'fixture: no puede salir del directorio'),
  z.url({ protocol: /^https$/ }),
]);

const csvColumnsSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  price: z.string().min(1),
  listPrice: z.string().optional(),
  imageUrl: z.string().optional(),
  gtin: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  sellerName: z.string().optional(),
  isMarketplace: z.string().optional(),
  condition: z.string().optional(),
  availability: z.string().optional(),
  currency: z.string().optional(),
});

export type CsvColumns = z.infer<typeof csvColumnsSchema>;

/** Configuración del adaptador de un comerciante (columna `merchants.provider_config`). */
export const providerConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixture'), location: feedLocationSchema }),
  z.object({
    kind: z.literal('csv'),
    location: feedLocationSchema,
    delimiter: z.enum([',', ';', '\t', '|']).default(','),
    /** Nombre de la columna del archivo para cada campo de la oferta. */
    columns: csvColumnsSchema,
  }),
  z.object({
    kind: z.literal('google_merchant'),
    location: feedLocationSchema,
    format: z.enum(['xml', 'tsv']),
  }),
]);

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
