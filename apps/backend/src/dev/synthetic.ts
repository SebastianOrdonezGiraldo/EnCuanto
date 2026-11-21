import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkDigit } from '../modules/normalization/index';

/**
 * Generador de feeds **sintéticos** y deterministas para el seed y los tests (§4, H1).
 * Tiendas, marcas, modelos, URLs (.example) y GTIN (prefijo GS1 2xx, de circulación
 * restringida) son inventados. La misma semilla y el mismo `day` producen los mismos archivos.
 */

/** PRNG mulberry32: determinista y sin dependencias. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits: para decisiones deterministas por (tienda, variante, día). */
function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const unit = (...parts: (string | number)[]) => hash(...parts) / 4294967296;

export const SYNTHETIC_BRANDS = [
  'Kalora',
  'Nubrix',
  'Tecnova',
  'Vireo',
  'Austral',
  'Zenkai',
  'Lumbra',
  'Ondina',
] as const;

const COLORS = ['Negro', 'Blanco', 'Gris', 'Azul', 'Verde', 'Plata', 'Rojo', 'Dorado'];

export interface SyntheticVariant {
  key: string;
  /** Producto (modelo) al que pertenece la variante: `p<n>`. */
  productKey: string;
  /** Nombre del producto sin los atributos de la variante (H2: ficha conocida del seed). */
  productName: string;
  /** Atributos de la variante tal como aparecen en el título ("256GB 8GB RAM Negro"). */
  label: string;
  brand: string;
  category: string;
  title: string;
  model: string;
  gtin: string;
  basePrice: number;
}

interface CategorySpec {
  name: string;
  lines: string[];
  basePrice: [number, number];
  variants: (r: () => number) => { label: string; factor: number }[];
  title: (brand: string, line: string, model: string, label: string) => string;
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const roundPrice = (n: number) => Math.max(9900, Math.round(n / 1000) * 1000 - 100);

const CATEGORIES: CategorySpec[] = [
  {
    name: 'Celulares',
    lines: ['Nova', 'Pulse', 'Orbit', 'Prime'],
    basePrice: [450_000, 3_500_000],
    variants: (r) =>
      [128, 256, 512]
        .filter(() => r() < 0.8)
        .map((gb, i) => ({
          label: `${gb}GB ${gb >= 256 ? 8 : 6}GB RAM ${pick(r, COLORS)}`,
          factor: 1 + i * 0.18,
        })),
    title: (b, l, m, v) => `Celular ${b} ${l} ${m} ${v}`,
  },
  {
    name: 'Televisores',
    lines: ['Vision', 'Cine', 'Luma'],
    basePrice: [1_000_000, 4_000_000],
    variants: (r) =>
      [43, 50, 55, 65, 75]
        .filter(() => r() < 0.6)
        .map((inch) => ({ label: `${inch}" 4K UHD`, factor: inch / 50 })),
    title: (b, l, m, v) => `Televisor ${b} ${l} ${v} Smart TV ${m}`,
  },
  {
    name: 'Neveras',
    lines: ['Frio', 'Polar', 'Glaciar'],
    basePrice: [1_200_000, 3_200_000],
    variants: (r) =>
      [250, 300, 360, 420, 520]
        .filter(() => r() < 0.5)
        .map((l) => ({
          label: `No Frost ${l} L ${pick(r, ['Gris', 'Plata', 'Negro'])}`,
          factor: l / 320,
        })),
    title: (b, l, m, v) => `Nevera ${b} ${l} ${v} ${m}`,
  },
  {
    name: 'Portátiles',
    lines: ['Book', 'Air', 'Work', 'Studio'],
    basePrice: [1_600_000, 6_500_000],
    variants: (r) =>
      [
        [8, 256],
        [16, 512],
        [32, 1024],
      ]
        .filter(() => r() < 0.7)
        .map(([ram, ssd], i) => ({
          label: `${pick(r, ['14"', '15.6"'])} ${ram}GB RAM ${ssd! >= 1024 ? '1TB' : `${ssd}GB`} SSD`,
          factor: 1 + i * 0.35,
        })),
    title: (b, l, m, v) => `Portátil ${b} ${l} ${v} ${m}`,
  },
  {
    name: 'Audífonos',
    lines: ['Sonic', 'Beat', 'Calma'],
    basePrice: [80_000, 1_200_000],
    variants: (r) =>
      COLORS.filter(() => r() < 0.35).map((c) => ({ label: `Inalámbricos ${c}`, factor: 1 })),
    title: (b, l, m, v) => `Audífonos ${b} ${l} ${m} ${v}`,
  },
  {
    name: 'Licuadoras',
    lines: ['Mix', 'Turbo'],
    basePrice: [150_000, 700_000],
    variants: (r) =>
      [1.5, 2, 3]
        .filter(() => r() < 0.6)
        .map((l) => ({
          label: `${String(l).replace('.', ',')} L ${pick(r, COLORS)}`,
          factor: 1 + (l - 1.5) / 3,
        })),
    title: (b, l, m, v) => `Licuadora ${b} ${l} ${m} ${v}`,
  },
  {
    name: 'Lavadoras',
    lines: ['Clean', 'Aqua'],
    basePrice: [1_100_000, 3_000_000],
    variants: (r) =>
      [13, 17, 19, 22]
        .filter(() => r() < 0.5)
        .map((kg) => ({
          label: `${kg} Kg Carga Superior ${pick(r, ['Blanca', 'Gris'])}`,
          factor: kg / 17,
        })),
    title: (b, l, m, v) => `Lavadora ${b} ${l} ${v} ${m}`,
  },
  {
    name: 'Tablets',
    lines: ['Tab', 'Pad'],
    basePrice: [500_000, 2_800_000],
    variants: (r) =>
      [64, 128, 256]
        .filter(() => r() < 0.6)
        .map((gb, i) => ({ label: `10,1" ${gb}GB ${pick(r, COLORS)}`, factor: 1 + i * 0.2 })),
    title: (b, l, m, v) => `Tablet ${b} ${l} ${m} ${v}`,
  },
];

/** GTIN-13 sintético con prefijo 2xx y dígito de control válido. */
function syntheticGtin(n: number): string {
  const body = `2${String(n).padStart(11, '0')}`;
  return body + checkDigit(`0${body}`);
}

/** Catálogo maestro de variantes (independiente de la tienda y del día). */
export function syntheticCatalog(seed = 2026, products = 420): SyntheticVariant[] {
  const r = prng(seed);
  const out: SyntheticVariant[] = [];
  let gtinCounter = 1;
  for (let p = 0; p < products; p++) {
    const category = CATEGORIES[p % CATEGORIES.length]!;
    const brand = pick(r, SYNTHETIC_BRANDS);
    const line = pick(r, category.lines);
    const model = `${brand.slice(0, 2).toUpperCase()}-${1000 + Math.floor(r() * 9000)}${pick(r, ['', 'X', 'P', 'S'])}`;
    const base = category.basePrice[0] + r() * (category.basePrice[1] - category.basePrice[0]);
    let variants = category.variants(r);
    if (variants.length === 0) variants = category.variants(() => 0); // al menos una
    for (const v of variants) {
      out.push({
        key: `p${p}-${out.length}`,
        productKey: `p${p}`,
        productName: category.title(brand, line, model, '').replace(/\s+/g, ' ').trim(),
        label: v.label,
        brand,
        category: category.name,
        title: category.title(brand, line, model, v.label),
        model,
        gtin: syntheticGtin(gtinCounter++),
        basePrice: roundPrice(base * v.factor),
      });
    }
  }
  return out;
}

export interface SyntheticMerchant {
  slug: string;
  name: string;
  brandColor: string;
  sourceType: 'affiliate_feed' | 'partner_feed' | 'manual';
  providerConfig: Record<string, unknown>;
}

/** Precio de una oferta en el día `day`: cambia con probabilidad 12 % por día. */
function priceOn(merchant: string, v: SyntheticVariant, day: number): number {
  let epoch = 0;
  for (let d = 1; d <= day; d++) if (unit(merchant, v.key, 'cambio', d) < 0.12) epoch = d;
  const factor = 0.9 + unit(merchant, v.key, 'precio', epoch) * 0.2;
  return roundPrice(v.basePrice * factor);
}

function listPriceFor(merchant: string, v: SyntheticVariant, price: number): number | null {
  const u = unit(merchant, v.key, 'lista');
  if (u < 0.7) return null;
  return roundPrice(price * (1.1 + unit(merchant, v.key, 'descuento') * 0.35));
}

const carried = (merchant: string, v: SyntheticVariant) => unit(merchant, v.key, 'surtido') < 0.78;

interface Offer {
  id: string;
  title: string;
  url: string;
  image: string;
  price: number;
  listPrice: number | null;
  gtin: string | null;
  brand: string;
  category: string;
  inStock: boolean;
}

/**
 * Índice en el catálogo maestro de la variante de una oferta sintética: los `external_id` son
 * `<prefijo>-<índice>` (`AUR-00042`). Devuelve null si el id no tiene esa forma.
 */
export function syntheticVariantIndex(externalId: string): number | null {
  const m = /^[A-Z]+-(\d{5,})$/.exec(externalId);
  return m ? Number(m[1]) : null;
}

function offersFor(
  slug: string,
  prefix: string,
  catalog: SyntheticVariant[],
  day: number,
): Offer[] {
  const offers: Offer[] = [];
  catalog.forEach((v, i) => {
    if (!carried(slug, v)) return;
    const id = `${prefix}-${String(i).padStart(5, '0')}`;
    const price = priceOn(slug, v, day);
    offers.push({
      id,
      title: v.title,
      url: `https://${slug}.example/p/${id}`,
      image: `https://${slug}.example/img/${id}.jpg`,
      price,
      listPrice: listPriceFor(slug, v, price),
      gtin: unit(slug, v.key, 'gtin') < 0.85 ? v.gtin : null,
      brand: v.brand,
      category: v.category,
      inStock: unit(slug, v.key, 'stock', day) < 0.9,
    });
  });
  return offers;
}

const cop = (n: number) => `$${n.toLocaleString('es-CO').replace(/,/g, '.')}`;
const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Registros inválidos deliberados (para probar la cuarentena). Iguales todos los días. */
function invalidRecords(slug: string) {
  return [
    { externalId: `${slug}-bad-1`, title: 'Oferta sin URL', price: 10000 },
    {
      externalId: `${slug}-bad-2`,
      title: 'Oferta con precio cero',
      url: `https://${slug}.example/p/bad-2`,
      price: 0,
    },
    {
      externalId: `${slug}-bad-3`,
      title: '',
      url: `https://${slug}.example/p/bad-3`,
      price: 10000,
    },
    {
      externalId: `${slug}-bad-4`,
      title: 'URL insegura',
      url: 'javascript:alert(1)',
      price: 10000,
    },
  ];
}

export interface GenerateOptions {
  /** Directorio donde escribir (por defecto `<fixtures>/generado`). */
  outDir: string;
  /** Día simulado: cada día ~12 % de las ofertas cambia de precio. */
  day?: number;
  /** Prefijo para los slugs (tests en paralelo sin chocar con el seed de desarrollo). */
  slugPrefix?: string;
  seed?: number;
  products?: number;
}

/**
 * Escribe los tres feeds (JSON de fixture, CSV con `;` y Google Merchant XML) y devuelve la
 * definición de los comerciantes con su `provider_config` apuntando a esos archivos.
 */
export function writeSyntheticFeeds(options: GenerateOptions): {
  merchants: SyntheticMerchant[];
  /** Catálogo maestro del que salen las ofertas (el seed crea con él las fichas de H2). */
  catalog: SyntheticVariant[];
  validOffers: number;
  invalidOffers: number;
} {
  const { outDir, day = 0, slugPrefix = '', seed = 2026, products = 420 } = options;
  const catalog = syntheticCatalog(seed, products);
  const subdir = path.basename(outDir);
  mkdirSync(outDir, { recursive: true });
  const slugs = {
    aurora: `${slugPrefix}tienda-aurora`,
    colibri: `${slugPrefix}mercado-colibri`,
    pacifico: `${slugPrefix}electro-pacifico`,
  };
  let valid = 0;
  let invalid = 0;

  // 1. Tienda Aurora: FixtureAdapter (JSON con los nombres de RawOffer).
  const aurora = offersFor(slugs.aurora, 'AUR', catalog, day);
  const auroraBad = invalidRecords(slugs.aurora);
  writeFileSync(
    path.join(outDir, `${slugs.aurora}.json`),
    JSON.stringify({
      offers: [
        ...aurora.map((o) => ({
          externalId: o.id,
          title: o.title,
          url: o.url,
          imageUrl: o.image,
          price: o.price,
          listPrice: o.listPrice,
          gtin: o.gtin,
          brand: o.brand,
          category: o.category,
          availability: o.inStock ? 'in_stock' : 'out_of_stock',
        })),
        ...auroraBad,
      ],
    }),
  );
  valid += aurora.length;
  invalid += auroraBad.length;

  // 2. Mercado Colibrí: CsvFeedAdapter (cabeceras en español, `;`, precios "$1.899.900").
  const colibri = offersFor(slugs.colibri, 'COL', catalog, day);
  const colibriBad = invalidRecords(slugs.colibri);
  const header = 'sku;nombre;enlace;imagen;precio;precio_antes;ean;marca;categoria;stock';
  const rows = colibri.map((o) =>
    [
      o.id,
      csvCell(o.title.toUpperCase()),
      o.url,
      o.image,
      cop(o.price),
      o.listPrice ? cop(o.listPrice) : '',
      o.gtin ?? '',
      o.brand.toUpperCase(),
      o.category,
      o.inStock ? 'disponible' : 'agotado',
    ].join(';'),
  );
  const badRows = colibriBad.map((b) =>
    [b.externalId, csvCell(b.title), b.url ?? '', '', String(b.price), '', '', '', '', ''].join(
      ';',
    ),
  );
  writeFileSync(
    path.join(outDir, `${slugs.colibri}.csv`),
    [header, ...rows, ...badRows].join('\n') + '\n',
  );
  valid += colibri.length;
  invalid += colibriBad.length;

  // 3. Electro Pacífico: Google Merchant XML (price/sale_price con "COP").
  const pacifico = offersFor(slugs.pacifico, 'EP', catalog, day);
  const pacificoBad = invalidRecords(slugs.pacifico);
  const item = (o: Offer) => {
    const regular = o.listPrice ?? o.price;
    return [
      '<item>',
      `<g:id>${o.id}</g:id>`,
      `<title>${xml(`${o.brand} ${o.title.replace(` ${o.brand}`, '')}`)}</title>`,
      `<link>${o.url}</link>`,
      `<g:image_link>${o.image}</g:image_link>`,
      `<g:price>${regular}.00 COP</g:price>`,
      o.listPrice ? `<g:sale_price>${o.price}.00 COP</g:sale_price>` : '',
      o.gtin ? `<g:gtin>${o.gtin}</g:gtin>` : '',
      `<g:brand>${xml(o.brand)}</g:brand>`,
      `<g:product_type>${xml(o.category)}</g:product_type>`,
      `<g:availability>${o.inStock ? 'in stock' : 'out of stock'}</g:availability>`,
      '<g:condition>new</g:condition>',
      '</item>',
    ].join('');
  };
  const badItems = pacificoBad.map(
    (b) =>
      `<item><g:id>${b.externalId}</g:id><title>${xml(b.title)}</title>${b.url ? `<link>${xml(b.url)}</link>` : ''}<g:price>${b.price} COP</g:price></item>`,
  );
  writeFileSync(
    path.join(outDir, `${slugs.pacifico}.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Electro Pacífico (sintético)</title>\n${[...pacifico.map(item), ...badItems].join('\n')}\n</channel></rss>\n`,
  );
  valid += pacifico.length;
  invalid += pacificoBad.length;

  return {
    catalog,
    validOffers: valid,
    invalidOffers: invalid,
    merchants: [
      {
        slug: slugs.aurora,
        name: 'Tienda Aurora (sintética)',
        brandColor: '#7C3AED',
        sourceType: 'manual',
        providerConfig: { kind: 'fixture', location: `fixture:${subdir}/${slugs.aurora}.json` },
      },
      {
        slug: slugs.colibri,
        name: 'Mercado Colibrí (sintético)',
        brandColor: '#0EA5E9',
        sourceType: 'partner_feed',
        providerConfig: {
          kind: 'csv',
          location: `fixture:${subdir}/${slugs.colibri}.csv`,
          delimiter: ';',
          columns: {
            externalId: 'sku',
            title: 'nombre',
            url: 'enlace',
            imageUrl: 'imagen',
            price: 'precio',
            listPrice: 'precio_antes',
            gtin: 'ean',
            brand: 'marca',
            category: 'categoria',
            availability: 'stock',
          },
        },
      },
      {
        slug: slugs.pacifico,
        name: 'Electro Pacífico (sintético)',
        brandColor: '#F97316',
        sourceType: 'affiliate_feed',
        providerConfig: {
          kind: 'google_merchant',
          location: `fixture:${subdir}/${slugs.pacifico}.xml`,
          format: 'xml',
        },
      },
    ],
  };
}
