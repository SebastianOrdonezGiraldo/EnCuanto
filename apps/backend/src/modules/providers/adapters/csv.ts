import { parse } from 'csv-parse';
import type { CsvColumns } from '../config';
import type { FeedSource } from '../feed-source';
import type { RawOfferInput } from '../raw-offer';
import type { ProviderAdapter, SourceType, SyncContext } from '../types';

/** Lee un CSV/TSV en streaming. Tolera BOM, CRLF (Windows) y filas con columnas de menos. */
export async function* readDelimited(
  stream: NodeJS.ReadableStream,
  delimiter: string,
  signal: AbortSignal,
): AsyncIterable<Record<string, string>> {
  const parser = stream.pipe(
    parse({
      columns: (header: string[]) => header.map((h) => h.trim()),
      bom: true,
      delimiter,
      relax_column_count: true,
      // Comillas sueltas dentro de un campo sin comillas (p. ej. 15.6") se conservan.
      relax_quotes: true,
      quote: delimiter === '\t' ? false : '"',
      skip_empty_lines: true,
      trim: true,
    }),
  );
  for await (const row of parser) {
    signal.throwIfAborted();
    yield row as Record<string, string>;
  }
}

/** CsvFeedAdapter (§9): CSV/TSV con mapeo de columnas configurable por comerciante. */
export class CsvFeedAdapter implements ProviderAdapter {
  readonly limits = { rps: 1, burst: 1 };

  constructor(
    readonly merchantSlug: string,
    readonly sourceType: SourceType,
    private readonly location: string,
    private readonly delimiter: string,
    private readonly columns: CsvColumns,
    private readonly source: FeedSource,
  ) {}

  async *sync(ctx: SyncContext): AsyncIterable<RawOfferInput> {
    const stream = await this.source.open(this.location, ctx.signal);
    const mapping = Object.entries(this.columns) as [keyof CsvColumns, string | undefined][];
    for await (const row of readDelimited(stream, this.delimiter, ctx.signal)) {
      const offer: RawOfferInput = {};
      for (const [field, column] of mapping) {
        if (column !== undefined && row[column] !== undefined) offer[field] = row[column];
      }
      yield offer;
    }
  }

  healthCheck() {
    return this.source.check(this.location, AbortSignal.timeout(10_000));
  }
}
