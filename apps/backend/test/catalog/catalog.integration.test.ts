import { categories, createDb, products, type DbClient } from '@encuanto/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIsolatedDatabase, type IsolatedDatabase } from '../../src/dev/isolated-db';
import { upsertCatalog, type CatalogEntryInput } from '../../src/modules/catalog/index';

const DATABASE_URL = process.env.DATABASE_URL;

const entry = (over: Partial<CatalogEntryInput>): CatalogEntryInput => ({
  category: { name: 'Neveras' },
  brand: 'Kalora',
  canonicalName: 'Nevera Kalora 300 L',
  modelNumber: null,
  variants: [{ key: 'v', gtin: null, attributes: {} }],
  ...over,
});

describe.skipIf(!DATABASE_URL)('catalog.upsertCatalog', () => {
  let isolated: IsolatedDatabase;
  let client: DbClient;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, 'catalog');
    client = createDb(isolated.url, { max: 2 });
  });

  afterAll(async () => {
    await client?.close();
    await isolated?.drop();
  });

  it('no quita la marca de accesorio si la entrada no la indica', async () => {
    await upsertCatalog(client.db, [entry({ category: { name: 'Fundas', accessory: true } })]);
    await upsertCatalog(client.db, [entry({ category: { name: 'Fundas' } })]);
    const [row] = await client.db.select().from(categories).where(eq(categories.slug, 'fundas'));
    expect(row!.accessory).toBe(true);

    await upsertCatalog(client.db, [entry({ category: { name: 'Fundas', accessory: false } })]);
    const [after] = await client.db.select().from(categories).where(eq(categories.slug, 'fundas'));
    expect(after!.accessory).toBe(false);
  });

  it('reutiliza el producto con el mismo modelo aunque cambie el nombre', async () => {
    const first = await upsertCatalog(client.db, [
      entry({
        canonicalName: 'Celular Kalora Nova',
        modelNumber: 'KA-1',
        category: { name: 'Celulares' },
      }),
    ]);
    const second = await upsertCatalog(client.db, [
      entry({
        canonicalName: 'Celular Kalora Nova 5G',
        modelNumber: 'KA-1',
        category: { name: 'Celulares' },
      }),
    ]);
    expect(second.get('v')).toBe(first.get('v'));
    const rows = await client.db.select().from(products).where(eq(products.modelNumber, 'KA-1'));
    expect(rows).toHaveLength(1);
  });

  it('sin modelo, el nombre no distingue mayúsculas', async () => {
    const first = await upsertCatalog(client.db, [
      entry({ canonicalName: 'Licuadora Kalora Pro' }),
    ]);
    const second = await upsertCatalog(client.db, [
      entry({ canonicalName: 'LICUADORA KALORA PRO' }),
    ]);
    expect(second.get('v')).toBe(first.get('v'));
  });
});
