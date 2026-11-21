import type { VariantAttributes } from '@encuanto/db';
import { checkDigit, normalizeGtin } from '../../src/modules/normalization/index';

/**
 * Set de prueba del matching (H3, criterio "precisión ≥ 95 % en auto‑matches").
 *
 * Catálogo y ofertas **sintéticos** (§4): marcas, modelos y GTIN inventados (prefijo GS1 2xx),
 * pero con los títulos como los escriben las tiendas: mayúsculas sostenidas, marca delante,
 * palabras de venta ("Envío gratis", "+ Obsequio"), colores en inglés, atributos que faltan,
 * GTIN ausentes o mal puestos, y negativos difíciles: la misma línea con otro número
 * ("Nova 12" / "Nova 13"), sufijos ("Pro"), accesorios y combos del mismo modelo, marcas
 * distintas con el mismo nombre de línea y variantes que solo se distinguen por los kilos.
 *
 * Cada oferta lleva la respuesta correcta, etiquetada a mano:
 *   - `variant`: es esa variante del catálogo;
 *   - `newVariantOf`: es ese producto, pero con atributos que el catálogo aún no tiene;
 *   - `ambiguous`: podría ser cualquiera de esas variantes (al título le falta el dato que las
 *     distingue); cualquier enlace automático es una adivinanza y cuenta como error;
 *   - `none`: no está en el catálogo (o no es un producto comparable); cualquier enlace
 *     automático es un error.
 */

/** GTIN-13 sintético válido (prefijo 2), normalizado a 14 dígitos como lo guarda la ingesta. */
export function gtin(n: number): string {
  const body = `29${String(n).padStart(10, '0')}`;
  return normalizeGtin(body + checkDigit(`0${body}`))!;
}

export interface DatasetVariant {
  key: string;
  gtin: string | null;
  attributes: VariantAttributes;
}

export interface DatasetProduct {
  key: string;
  brand: string | null;
  name: string;
  model: string | null;
  accessoryCategory?: boolean;
  category: string;
  variants: DatasetVariant[];
}

export type Expected =
  | { variant: string }
  | { newVariantOf: string }
  | { ambiguous: string[] }
  | { none: true };

export interface DatasetOffer {
  /** Título tal como lo da la tienda. */
  title: string;
  /** Marca normalizada que daría la ingesta (null si la fuente no la trae y no está en el título). */
  brand: string | null;
  gtin: string | null;
  expected: Expected;
  /** Qué pone a prueba el caso. */
  note: string;
}

const v = (key: string, g: number | null, attributes: VariantAttributes): DatasetVariant => ({
  key,
  gtin: g === null ? null : gtin(g),
  attributes,
});

export const CATALOG: DatasetProduct[] = [
  {
    key: 'nova12',
    brand: 'kalora',
    name: 'Celular Kalora Nova 12',
    model: 'KA-N12',
    category: 'Celulares',
    variants: [
      v('nova12-128-negro', 1, { storage_gb: 128, ram_gb: 6, color: 'negro' }),
      v('nova12-256-negro', 2, { storage_gb: 256, ram_gb: 8, color: 'negro' }),
      v('nova12-256-azul', 3, { storage_gb: 256, ram_gb: 8, color: 'azul' }),
    ],
  },
  {
    key: 'nova12pro',
    brand: 'kalora',
    name: 'Celular Kalora Nova 12 Pro',
    model: 'KA-N12P',
    category: 'Celulares',
    variants: [
      v('nova12pro-256-negro', 4, { storage_gb: 256, ram_gb: 8, color: 'negro' }),
      v('nova12pro-512-gris', 5, { storage_gb: 512, ram_gb: 12, color: 'gris' }),
    ],
  },
  {
    key: 'nova13',
    brand: 'kalora',
    name: 'Celular Kalora Nova 13',
    model: 'KA-N13',
    category: 'Celulares',
    variants: [v('nova13-256-verde', 6, { storage_gb: 256, ram_gb: 8, color: 'verde' })],
  },
  {
    key: 'a56',
    brand: 'nubrix',
    name: 'Celular Nubrix Pulse A56',
    model: 'NX-A566B',
    category: 'Celulares',
    variants: [
      v('a56-128-negro', 7, { storage_gb: 128, ram_gb: 8, color: 'negro' }),
      v('a56-256-negro', null, { storage_gb: 256, ram_gb: 8, color: 'negro' }),
    ],
  },
  {
    key: 'a36',
    brand: 'nubrix',
    name: 'Celular Nubrix Pulse A36',
    model: 'NX-A366B',
    category: 'Celulares',
    variants: [v('a36-128-azul', 8, { storage_gb: 128, ram_gb: 6, color: 'azul' })],
  },
  {
    key: 'tv55',
    brand: 'tecnova',
    name: 'Televisor Tecnova Vision QLED',
    model: 'TV-55Q7',
    category: 'Televisores',
    variants: [v('tv55', 9, { screen_in: 55 })],
  },
  {
    key: 'tv65',
    brand: 'tecnova',
    name: 'Televisor Tecnova Vision QLED',
    model: 'TV-65Q7',
    category: 'Televisores',
    variants: [v('tv65', 10, { screen_in: 65 })],
  },
  {
    key: 'nevera360',
    brand: 'austral',
    name: 'Nevera Austral Polar No Frost',
    model: 'AU-NF360',
    category: 'Neveras',
    variants: [
      v('nevera360-gris', 11, { capacity_l: 360, color: 'gris' }),
      v('nevera360-plata', 12, { capacity_l: 360, color: 'plata' }),
    ],
  },
  {
    key: 'nevera420',
    brand: 'austral',
    name: 'Nevera Austral Polar No Frost',
    model: 'AU-NF420',
    category: 'Neveras',
    variants: [v('nevera420-gris', 13, { capacity_l: 420, color: 'gris' })],
  },
  {
    key: 'lav17',
    brand: 'zenkai',
    name: 'Lavadora Zenkai Aqua Carga Superior',
    model: 'ZK-AQ17',
    category: 'Lavadoras',
    variants: [v('lav17-gris', 14, { weight_kg: 17, color: 'gris' })],
  },
  {
    key: 'lav19',
    brand: 'zenkai',
    name: 'Lavadora Zenkai Aqua Carga Superior',
    model: 'ZK-AQ19',
    category: 'Lavadoras',
    variants: [v('lav19-gris', 15, { weight_kg: 19, color: 'gris' })],
  },
  {
    key: 'book14',
    brand: 'vireo',
    name: 'Portátil Vireo Book 14',
    model: 'VR-B14',
    category: 'Portátiles',
    variants: [
      v('book14-8-256', 16, { screen_in: 14, ram_gb: 8, storage_gb: 256 }),
      v('book14-16-512', 17, { screen_in: 14, ram_gb: 16, storage_gb: 512 }),
    ],
  },
  {
    key: 'book15',
    brand: 'vireo',
    name: 'Portátil Vireo Book 15',
    model: 'VR-B15',
    category: 'Portátiles',
    variants: [v('book15-16-512', 18, { screen_in: 15.6, ram_gb: 16, storage_gb: 512 })],
  },
  {
    key: 'calma',
    brand: 'lumbra',
    name: 'Audífonos Lumbra Calma',
    model: 'LB-C300',
    category: 'Audífonos',
    variants: [
      v('calma-negro', 19, { color: 'negro' }),
      v('calma-blanco', 20, { color: 'blanco' }),
    ],
  },
  {
    key: 'funda-nova12',
    brand: 'kalora',
    name: 'Funda para Celular Kalora Nova 12',
    model: null,
    accessoryCategory: true,
    category: 'Fundas',
    variants: [v('funda-nova12', null, {})],
  },
  {
    key: 'mix600',
    brand: 'ondina',
    name: 'Licuadora Ondina Mix 600',
    model: 'OD-M600',
    category: 'Licuadoras',
    variants: [
      v('mix600-rojo', 21, { capacity_l: 1.5, color: 'rojo' }),
      v('mix600-negro', 22, { capacity_l: 1.5, color: 'negro' }),
    ],
  },
  {
    key: 'tab10',
    brand: 'nubrix',
    name: 'Tablet Nubrix Tab 10',
    model: 'NX-T10',
    category: 'Tablets',
    variants: [
      v('tab10-64', 23, { storage_gb: 64, color: 'gris' }),
      v('tab10-128', 24, { storage_gb: 128, color: 'gris' }),
    ],
  },
  {
    key: 'crisp',
    brand: 'ondina',
    name: 'Freidora de Aire Ondina Crisp',
    model: null,
    category: 'Freidoras',
    variants: [v('crisp-negro', null, { capacity_l: 4.5, color: 'negro' })],
  },
  {
    key: 'aroma',
    brand: 'lumbra',
    name: 'Cafetera Lumbra Aroma 12 Tazas',
    model: null,
    category: 'Cafeteras',
    variants: [v('aroma', null, {})],
  },
];

const o = (
  title: string,
  brand: string | null,
  g: number | null,
  expected: Expected,
  note: string,
): DatasetOffer => ({ title, brand, gtin: g === null ? null : gtin(g), expected, note });

/** GTIN válido que no está en el catálogo. */
const NEW_GTIN = 900;

export const OFFERS: DatasetOffer[] = [
  // Celular Kalora Nova 12
  o(
    'Celular Kalora Nova 12 KA-N12 128GB 6GB RAM Negro',
    'kalora',
    1,
    { variant: 'nova12-128-negro' },
    'GTIN (nivel 1)',
  ),
  o(
    'CELULAR KALORA NOVA 12 128GB 6GB RAM NEGRO',
    'kalora',
    null,
    { variant: 'nova12-128-negro' },
    'mayúsculas, sin modelo ni GTIN (nivel 3)',
  ),
  o(
    'Kalora Nova 12 256GB 8GB Black - Envío gratis',
    'kalora',
    null,
    { variant: 'nova12-256-negro' },
    'sin "Celular", color en inglés, palabras de venta',
  ),
  o(
    'Smartphone Kalora Nova 12 Dual SIM 8+256GB Azul',
    'kalora',
    null,
    { variant: 'nova12-256-azul' },
    'RAM+almacenamiento "8+256GB"',
  ),
  o(
    'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Azul + Obsequio',
    'kalora',
    null,
    { variant: 'nova12-256-azul' },
    'modelo (nivel 2) con "+ Obsequio"',
  ),
  o(
    'Celular Kalora Nova 12 256 GB',
    'kalora',
    null,
    { ambiguous: ['nova12-256-negro', 'nova12-256-azul'] },
    'falta el color: dos variantes posibles',
  ),
  o(
    'Celular Kalora Nova 12 KA-N12 512GB 8GB RAM Negro',
    'kalora',
    null,
    { newVariantOf: 'nova12' },
    'mismo modelo, capacidad nueva',
  ),
  o(
    'Celular Kalora Nova 11 128GB 6GB RAM Negro',
    'kalora',
    null,
    { none: true },
    'otro número de la línea ("11")',
  ),
  o(
    'Celular Nova 12 128GB 6GB RAM Negro',
    null,
    null,
    { variant: 'nova12-128-negro' },
    'sin marca: el nivel 3 exige marca',
  ),
  o(
    'Celular Zenkai Nova 12 128GB 6GB Negro',
    'zenkai',
    null,
    { none: true },
    'otra marca con la misma línea',
  ),
  o(
    'Celular Nubrix Pulse A56 128GB 8GB Negro',
    'nubrix',
    1,
    { variant: 'a56-128-negro' },
    'GTIN de otro producto (marca distinta)',
  ),
  o(
    'Celular Kalora Nova 12 KA-N12 256GB 8GB RAM Negro',
    'kalora',
    6,
    { variant: 'nova12-256-negro' },
    'GTIN de otra variante con color distinto',
  ),
  // Nova 12 Pro y Nova 13
  o(
    'Celular Kalora Nova 12 Pro 256GB 8GB Negro',
    'kalora',
    null,
    { variant: 'nova12pro-256-negro' },
    'sufijo "Pro" frente a la ficha sin él',
  ),
  o(
    'Kalora Celular Nova 12 Pro KA-N12P 512GB 12GB RAM Gris',
    'kalora',
    5,
    { variant: 'nova12pro-512-gris' },
    'marca delante (feed de Google)',
  ),
  o(
    'CELULAR KALORA NOVA 12 PRO 512GB 12GB RAM GRIS',
    'kalora',
    null,
    { variant: 'nova12pro-512-gris' },
    'mayúsculas',
  ),
  o(
    'Celular Kalora Nova 13 256GB 8GB RAM Verde',
    'kalora',
    null,
    { variant: 'nova13-256-verde' },
    '"13" frente a "12"',
  ),
  o(
    'Celular Kalora Nova 13 KA-N13 256GB 8GB Green',
    'kalora',
    null,
    { variant: 'nova13-256-verde' },
    'modelo y color en inglés',
  ),
  // Accesorios del Nova 12
  o(
    'Funda para Celular Kalora Nova 12 Transparente',
    'kalora',
    null,
    { variant: 'funda-nova12' },
    'accesorio con su ficha de accesorio',
  ),
  o(
    'Vidrio Templado Kalora Nova 12',
    'kalora',
    null,
    { none: true },
    'accesorio sin ficha: no es el celular',
  ),
  o(
    'Cargador para Celular Kalora Nova 12 KA-N12 25W',
    'kalora',
    null,
    { none: true },
    'accesorio con el modelo del celular',
  ),
  o(
    'Combo Celular Kalora Nova 12 KA-N12 128GB 6GB Negro + Audífonos',
    'kalora',
    null,
    { none: true },
    'combo con el modelo del celular',
  ),
  // Nubrix Pulse A56 / A36
  o(
    'Celular Nubrix Pulse A56 5G 128GB 8GB Negro',
    'nubrix',
    7,
    { variant: 'a56-128-negro' },
    'GTIN; "5G" no identifica',
  ),
  o(
    'NUBRIX PULSE A56 NX-A566B 256GB 8GB RAM NEGRO',
    'nubrix',
    null,
    { variant: 'a56-256-negro' },
    'modelo con guion',
  ),
  o(
    'Celular Nubrix Pulse A56 NXA566B 256GB 8GB RAM Negro',
    'nubrix',
    NEW_GTIN,
    { variant: 'a56-256-negro' },
    'modelo sin guion y GTIN que el catálogo no tenía',
  ),
  o(
    'Celular Nubrix Pulse A56 256GB 8GB Negro',
    'nubrix',
    null,
    { variant: 'a56-256-negro' },
    'sin modelo (nivel 3)',
  ),
  o(
    'Celular Nubrix Pulse A36 128GB 6GB Azul',
    'nubrix',
    null,
    { variant: 'a36-128-azul' },
    '"A36" frente a "A56" (similitud 0,82)',
  ),
  o(
    'Celular Nubrix Pulse A26 128GB 6GB Azul',
    'nubrix',
    null,
    { none: true },
    'modelo inexistente de la misma línea',
  ),
  // Televisores
  o(
    'Televisor Tecnova 55" QLED 4K Smart TV TV-55Q7',
    'tecnova',
    null,
    { variant: 'tv55' },
    'modelo (nivel 2)',
  ),
  o(
    'Televisor Tecnova Vision QLED 55 Pulgadas TV-55Q7 Negro',
    'tecnova',
    9,
    { variant: 'tv55' },
    'GTIN',
  ),
  o(
    'Televisor Tecnova Vision QLED 65" 4K UHD',
    'tecnova',
    null,
    { variant: 'tv65' },
    'dos fichas con el mismo nombre: decide la pulgada',
  ),
  o(
    'Televisor Tecnova Vision QLED 75 pulgadas',
    'tecnova',
    null,
    { none: true },
    'pulgada que no está en el catálogo',
  ),
  // Neveras
  o(
    'Nevera Austral Polar No Frost 360 Litros Gris AU-NF360',
    'austral',
    null,
    { variant: 'nevera360-gris' },
    'modelo y litros',
  ),
  o(
    'NEVERA AUSTRAL POLAR NO FROST 360 LTS PLATEADA',
    'austral',
    null,
    { variant: 'nevera360-plata' },
    'mayúsculas, "plateada"',
  ),
  o(
    'Nevera Austral Polar No Frost 420 L',
    'austral',
    null,
    { variant: 'nevera420-gris' },
    'sin color, una sola variante compatible',
  ),
  o(
    'Nevera Austral Polar No Frost 360L',
    'austral',
    null,
    { ambiguous: ['nevera360-gris', 'nevera360-plata'] },
    'falta el color',
  ),
  o(
    'Nevera Austral Polar No Frost 300 L Gris',
    'austral',
    null,
    { none: true },
    'litros que no están en el catálogo',
  ),
  // Lavadoras
  o(
    'Lavadora Zenkai Aqua Carga Superior 17 Kg Gris',
    'zenkai',
    null,
    { variant: 'lav17-gris' },
    'los kilos distinguen la ficha',
  ),
  o('Lavadora Zenkai Aqua 19kg ZK-AQ19 Gris', 'zenkai', null, { variant: 'lav19-gris' }, 'modelo'),
  o(
    'LAVADORA ZENKAI AQUA CARGA SUPERIOR 19 KILOS GRIS',
    'zenkai',
    null,
    { variant: 'lav19-gris' },
    '"kilos" en mayúsculas',
  ),
  o(
    'Lavadora Zenkai Aqua Carga Superior 22 Kg Gris',
    'zenkai',
    null,
    { none: true },
    'kilos que no están en el catálogo',
  ),
  // Portátiles
  o(
    'Portátil Vireo Book 14 VR-B14 16GB RAM 512GB SSD',
    'vireo',
    null,
    // La variante del catálogo dice 14": el título no trae la pantalla. Sin GTIN, que falte un
    // atributo no prueba que sea la misma configuración: variante propia, no la de 14".
    { newVariantOf: 'book14' },
    'modelo (nivel 2) sin la pantalla en el título',
  ),
  o(
    'Portátil Vireo Book 14 Intel Core i5 8GB RAM 256GB SSD 14"',
    'vireo',
    null,
    { variant: 'book14-8-256' },
    'procesador en el título',
  ),
  o(
    'PORTATIL VIREO BOOK 15 15.6" 16GB 512GB SSD',
    'vireo',
    null,
    { variant: 'book15-16-512' },
    '"15" frente a "14"',
  ),
  o(
    'Portátil Vireo Book 14 VR-B14 32GB RAM 1TB SSD',
    'vireo',
    null,
    { newVariantOf: 'book14' },
    'mismo modelo, configuración nueva',
  ),
  // Audífonos
  o(
    'Audífonos Inalámbricos Lumbra Calma LB-C300 Bluetooth Negro',
    'lumbra',
    null,
    { variant: 'calma-negro' },
    'modelo',
  ),
  o(
    'Audifonos Lumbra Calma ANC White',
    'lumbra',
    null,
    { variant: 'calma-blanco' },
    'sin tilde, color en inglés',
  ),
  o(
    'Audífonos Lumbra Calma LB-C300 Rosado',
    'lumbra',
    null,
    { newVariantOf: 'calma' },
    'color nuevo con modelo',
  ),
  o('Audífonos Lumbra Calma Rosado', 'lumbra', null, { none: true }, 'color nuevo sin modelo'),
  o(
    'Combo Audífonos Lumbra Calma LB-C300 x2 Negro',
    'lumbra',
    null,
    { none: true },
    'combo de dos unidades',
  ),
  o(
    'Estuche para Audífonos Lumbra Calma LB-C300',
    'lumbra',
    null,
    { none: true },
    'accesorio con el modelo',
  ),
  // Licuadoras
  o(
    'Licuadora Ondina Mix 600 1.5 Litros Roja OD-M600',
    'ondina',
    null,
    { variant: 'mix600-rojo' },
    'litros con punto',
  ),
  o(
    'Licuadora Ondina Mix 600 1,5 L Negra',
    'ondina',
    null,
    { variant: 'mix600-negro' },
    'litros con coma, sin modelo',
  ),
  o(
    'Licuadora Ondina Mix 600 vaso de vidrio 1,5 L Negra',
    'ondina',
    22,
    { variant: 'mix600-negro' },
    '"vidrio" no la vuelve accesorio',
  ),
  o('Cuchilla Repuesto Licuadora Ondina Mix 600', 'ondina', null, { none: true }, 'repuesto'),
  // Tablets
  o('Tablet Nubrix Tab 10 NX-T10 10,1" 128GB Gris', 'nubrix', 24, { variant: 'tab10-128' }, 'GTIN'),
  o(
    'Tablet Nubrix Tab 10 64GB Grey',
    'nubrix',
    null,
    { variant: 'tab10-64' },
    'sin modelo, "grey"',
  ),
  o(
    'Tablet Nubrix Tab 10 Pro 128GB',
    'nubrix',
    null,
    { none: true },
    'sufijo "Pro" que el catálogo no tiene',
  ),
  // Sin modelo en el catálogo
  o(
    'Freidora de Aire Ondina Crisp 4,5 L Negra',
    'ondina',
    null,
    { variant: 'crisp-negro' },
    'ficha sin modelo',
  ),
  o(
    'Freidora de aire Ondina Crisp 5,5 Litros Negra',
    'ondina',
    null,
    { none: true },
    'capacidad distinta',
  ),
  o(
    'Cafetera Lumbra Aroma 12 Tazas Negra',
    'lumbra',
    null,
    { variant: 'aroma' },
    'la variante no tiene atributos',
  ),
  o(
    'Cafetera Lumbra Aroma 6 Tazas',
    'lumbra',
    null,
    { none: true },
    '"6 tazas" frente a "12 tazas"',
  ),
  // Productos que no están
  o('Celular Ondina Fly 5 64GB 4GB RAM Azul', 'ondina', null, { none: true }, 'producto nuevo'),
  o(
    'Smart TV Kalora 50 pulgadas 4K KA-TV50',
    'kalora',
    null,
    { none: true },
    'producto nuevo de una marca conocida',
  ),
  o('Nevera Kalora Frio 250 L', 'kalora', null, { none: true }, 'producto nuevo'),
];

/**
 * Formas habituales de la misma oferta en otras tiendas: todo en mayúsculas (feeds CSV) y la
 * marca delante (Google Merchant). No cambian la respuesta correcta.
 */
export function storeStyles(offer: DatasetOffer): DatasetOffer[] {
  const upper = { ...offer, title: offer.title.toUpperCase(), note: `${offer.note} [mayúsculas]` };
  const out = [offer];
  if (upper.title !== offer.title) out.push(upper);
  if (offer.brand) {
    const re = new RegExp(`\\s${offer.brand}\\b`, 'i');
    const m = re.exec(offer.title);
    if (m && m.index > 0) {
      const title = `${m[0].trim()} ${offer.title.replace(re, '')}`;
      out.push({ ...offer, title, note: `${offer.note} [marca delante]` });
    }
  }
  return out;
}

export const ALL_OFFERS: DatasetOffer[] = OFFERS.flatMap(storeStyles);
