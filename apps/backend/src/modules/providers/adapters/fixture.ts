import type { Readable } from 'node:stream';
import type { FeedSource } from '../feed-source';
import type { RawOfferInput } from '../raw-offer';
import type { ProviderAdapter, SourceType, SyncContext } from '../types';

async function readAll(stream: Readable): Promise<string> {
  stream.setEncoding('utf8');
  let text = '';
  for await (const chunk of stream) text += chunk as string;
  return text;
}

/**
 * FixtureAdapter (§9): lee un JSON con ofertas **sintéticas**, ya con los nombres de campo de
 * `RawOffer`. Formato: `{ "offers": [...] }` o un arreglo. Sirve para dev, tests y demo.
 */
export class FixtureAdapter implements ProviderAdapter {
  readonly limits = { rps: 1, burst: 1 };

  constructor(
    readonly merchantSlug: string,
    readonly sourceType: SourceType,
    private readonly location: string,
    private readonly source: FeedSource,
  ) {}

  async *sync(ctx: SyncContext): AsyncIterable<RawOfferInput> {
    const text = await readAll(await this.source.open(this.location, ctx.signal));
    const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    const list = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { offers?: unknown }).offers)
        ? (data as { offers: unknown[] }).offers
        : null;
    if (!list) throw new Error('el fixture debe ser un arreglo o { "offers": [...] }');
    for (const item of list) {
      ctx.signal.throwIfAborted();
      // Lo que no es objeto se entrega igual: la validación lo manda a cuarentena.
      yield item && typeof item === 'object' ? (item as RawOfferInput) : { value: item };
    }
  }

  healthCheck() {
    return this.source.check(this.location, AbortSignal.timeout(10_000));
  }
}
