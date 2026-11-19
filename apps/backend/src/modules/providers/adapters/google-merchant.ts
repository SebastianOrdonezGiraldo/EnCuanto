import { SaxesParser } from 'saxes';
import type { Readable } from 'node:stream';
import type { FeedSource } from '../feed-source';
import type { RawOfferInput } from '../raw-offer';
import type { ProviderAdapter, SourceType, SyncContext } from '../types';
import { readDelimited } from './csv';

/** Nombre local de un elemento o columna: `g:price` → `price`. */
const local = (name: string) =>
  name
    .slice(name.indexOf(':') + 1)
    .trim()
    .toLowerCase();

/**
 * Lee los `<item>` de un feed RSS 2.0 de Google Merchant en streaming. Solo toma el texto de los
 * hijos directos (`g:id`, `title`, `g:price`…). saxes no procesa DTD ni entidades externas,
 * así que un feed malicioso no puede leer archivos locales (XXE).
 */
export async function* readGoogleXml(
  stream: Readable,
  signal: AbortSignal,
): AsyncIterable<Record<string, string>> {
  const parser = new SaxesParser();
  const ready: Record<string, string>[] = [];
  let item: Record<string, string> | null = null;
  let depth = 0;
  let field: string | null = null;
  let text = '';

  parser.on('opentag', (node) => {
    if (!item) {
      if (local(node.name) === 'item') {
        item = {};
        depth = 0;
      }
      return;
    }
    depth++;
    if (depth === 1) {
      field = local(node.name);
      text = '';
    }
  });
  const onText = (t: string) => {
    if (item && depth === 1 && field) text += t;
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => {
    if (!item) return;
    if (depth === 0) {
      ready.push(item);
      item = null;
      return;
    }
    if (depth === 1 && field) {
      // Si un campo se repite (p. ej. varias imágenes), vale el primero.
      item[field] ??= text.trim();
      field = null;
    }
    depth--;
  });

  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    signal.throwIfAborted();
    parser.write(chunk as string);
    while (ready.length > 0) yield ready.shift()!;
  }
  parser.close();
  while (ready.length > 0) yield ready.shift()!;
}

/** Separa "1899900.00 COP" en importe y moneda. */
function splitPrice(value: string | undefined): { amount?: string; currency?: string } {
  if (!value) return {};
  const m = /^(.*?)\s*([A-Za-z]{3})$/.exec(value.trim());
  return m ? { amount: m[1], currency: m[2]!.toUpperCase() } : { amount: value.trim() };
}

/**
 * Traduce un registro de Google Merchant a `RawOffer`. En ese formato `price` es el precio
 * normal y `sale_price` el de oferta: si hay `sale_price`, ese es el precio y `price` el de lista.
 *
 * Las monedas explícitas de los dos importes se comprueban antes de descartarlas: si difieren
 * (p. ej. `1000 USD` y `900 COP`), `currency` queda como `USD/COP`, que no es COP, y el
 * registro va a cuarentena en vez de mezclar importes de monedas distintas.
 */
export function mapGoogleRecord(rec: Record<string, string>): RawOfferInput {
  const regular = splitPrice(rec.price);
  const sale = splitPrice(rec.sale_price);
  const hasSale = Boolean(sale.amount);
  const currencies = [
    ...new Set([regular.currency, hasSale ? sale.currency : undefined].filter(Boolean)),
  ];
  return {
    externalId: rec.id,
    title: rec.title,
    url: rec.link,
    imageUrl: rec.image_link,
    price: hasSale ? sale.amount : regular.amount,
    listPrice: hasSale ? regular.amount : undefined,
    currency: currencies.length > 0 ? currencies.join('/') : undefined,
    gtin: rec.gtin,
    brand: rec.brand,
    category: rec.product_type ?? rec.google_product_category,
    availability: rec.availability,
    condition: rec.condition,
  };
}

/** GoogleMerchantFeedAdapter (§9): feed estándar de productos en XML (RSS) o TSV. */
export class GoogleMerchantFeedAdapter implements ProviderAdapter {
  readonly limits = { rps: 1, burst: 1 };

  constructor(
    readonly merchantSlug: string,
    readonly sourceType: SourceType,
    private readonly location: string,
    private readonly format: 'xml' | 'tsv',
    private readonly source: FeedSource,
  ) {}

  async *sync(ctx: SyncContext): AsyncIterable<RawOfferInput> {
    const stream = await this.source.open(this.location, ctx.signal);
    const records =
      this.format === 'xml'
        ? readGoogleXml(stream, ctx.signal)
        : readDelimited(stream, '\t', ctx.signal);
    for await (const rec of records) {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) normalized[local(k)] = v;
      yield mapGoogleRecord(normalized);
    }
  }

  healthCheck() {
    return this.source.check(this.location, AbortSignal.timeout(10_000));
  }
}
