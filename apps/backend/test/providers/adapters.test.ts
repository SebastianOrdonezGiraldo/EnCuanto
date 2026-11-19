import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createAdapter,
  mapGoogleRecord,
  ProviderConfigError,
  rawOfferSchema,
  readDelimited,
  readGoogleXml,
} from '../../src/modules/providers/index';
import { collect, FIXTURES_DIR } from './helpers';

const signal = new AbortController().signal;
const ctx = (merchantSlug: string) => ({ merchantSlug, signal });
const options = { fixturesDir: FIXTURES_DIR };

describe('FixtureAdapter', () => {
  it('lee el JSON y entrega los registros, válidos o no', async () => {
    const adapter = createAdapter(
      {
        slug: 'tienda-aurora',
        sourceType: 'manual',
        providerConfig: { kind: 'fixture', location: 'fixture:ejemplos/fixture-basico.json' },
      },
      options,
    );
    const records = await collect(adapter.sync(ctx('tienda-aurora')));
    expect(records).toHaveLength(5);
    const parsed = records.map((r) => rawOfferSchema.safeParse(r));
    expect(parsed.map((p) => p.success)).toEqual([true, true, true, true, false]);
    expect(parsed[1]!.data).toMatchObject({ availability: 'out_of_stock', condition: 'new' });
    expect(parsed[2]!.data).toMatchObject({ condition: 'refurbished', availability: 'unknown' });
    await expect(adapter.healthCheck()).resolves.toEqual({ ok: true });
  });

  it('healthCheck falla si el archivo no existe', async () => {
    const adapter = createAdapter(
      {
        slug: 'x',
        sourceType: 'manual',
        providerConfig: { kind: 'fixture', location: 'fixture:no-existe.json' },
      },
      options,
    );
    await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: false });
  });
});

describe('CsvFeedAdapter', () => {
  const adapter = createAdapter(
    {
      slug: 'mercado-colibri',
      sourceType: 'partner_feed',
      providerConfig: {
        kind: 'csv',
        location: 'fixture:ejemplos/csv-punto-y-coma.csv',
        delimiter: ';',
        columns: {
          externalId: 'sku',
          title: 'nombre',
          url: 'enlace',
          price: 'precio',
          listPrice: 'precio_antes',
          gtin: 'ean',
          brand: 'marca',
          availability: 'stock',
        },
      },
    },
    options,
  );

  it('mapea las columnas, respeta comillas y quita el BOM', async () => {
    const records = await collect(adapter.sync(ctx('mercado-colibri')));
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      externalId: 'COL-1',
      title: 'Licuadora Ondina 1,5 L Roja',
      price: '$189.900',
      listPrice: '$229.900',
      gtin: '2000000000022',
    });
    expect(records[1]!.title).toBe('Audífonos Vireo "Pro"; inalámbricos');
    expect(rawOfferSchema.safeParse(records[3]).success).toBe(false);
  });

  it('lee CRLF (archivos de Windows) igual que LF', async () => {
    const crlf = 'id,titulo\r\nA-1,"Uno"\r\nA-2,Dos\r\n';
    const rows = await collect(readDelimited(Readable.from([crlf]), ',', signal));
    expect(rows).toEqual([
      { id: 'A-1', titulo: 'Uno' },
      { id: 'A-2', titulo: 'Dos' },
    ]);
  });
});

describe('GoogleMerchantFeedAdapter', () => {
  it('lee el XML: CDATA, entidades, sale_price y campos anidados ignorados', async () => {
    const adapter = createAdapter(
      {
        slug: 'electro-pacifico',
        sourceType: 'affiliate_feed',
        providerConfig: {
          kind: 'google_merchant',
          location: 'fixture:ejemplos/google-merchant.xml',
          format: 'xml',
        },
      },
      options,
    );
    const records = await collect(adapter.sync(ctx('electro-pacifico')));
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      externalId: 'EP-100',
      title: 'Lavadora Zenkai 19 Kg Carga Superior & Blanca',
      price: '1999900.00',
      listPrice: '2499900.00',
      currency: 'COP',
      gtin: '2000000000046',
      availability: 'in stock',
    });
    expect(records[1]).toMatchObject({ title: 'Monitor Lumbra 27" IPS LM-27Q', price: '899900' });
    const parsed = records.map((r) => rawOfferSchema.safeParse(r));
    expect(parsed.map((p) => p.success)).toEqual([true, true, false]); // USD → cuarentena
  });

  it('lee el TSV con las mismas reglas', async () => {
    const adapter = createAdapter(
      {
        slug: 'electro-pacifico',
        sourceType: 'affiliate_feed',
        providerConfig: {
          kind: 'google_merchant',
          location: 'fixture:ejemplos/google-merchant.tsv',
          format: 'tsv',
        },
      },
      options,
    );
    const records = await collect(adapter.sync(ctx('electro-pacifico')));
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      externalId: 'EP-201',
      price: '699900',
      listPrice: '799900',
      availability: 'preorder',
    });
    expect(rawOfferSchema.parse(records[1]).availability).toBe('preorder');
  });

  it('no expande entidades externas (XXE)', async () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>1</g:id><title>&xxe;</title></item></channel></rss>`;
    await expect(collect(readGoogleXml(Readable.from([xml]), signal))).rejects.toThrow();
  });

  it('mapGoogleRecord sin sale_price usa price como precio', () => {
    expect(mapGoogleRecord({ id: '1', price: '1000 COP' })).toMatchObject({
      price: '1000',
      listPrice: undefined,
      currency: 'COP',
    });
  });
});

describe('createAdapter', () => {
  it.each([
    [{ kind: 'scraper', location: 'https://tienda.example' }],
    [{ kind: 'fixture', location: 'fixture:../../secreto.json' }],
    [{ kind: 'fixture', location: 'http://inseguro.example/feed.json' }],
    [null],
  ])('rechaza configuraciones inválidas: %j', (providerConfig) => {
    expect(() =>
      createAdapter({ slug: 'x', sourceType: 'manual', providerConfig }, options),
    ).toThrow(ProviderConfigError);
  });
});
