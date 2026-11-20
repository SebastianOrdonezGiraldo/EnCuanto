import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbClient } from './client';
import { runMigrations } from './migrate';
import { merchants, offers, products, productVariants } from './schema';

// Test de integración: necesita PostgreSQL (infra/docker-compose.yml o el servicio del CI).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('migraciones', () => {
  let client: DbClient;

  beforeAll(async () => {
    await runMigrations(url!);
    client = createDb(url!, { max: 1 });
  });

  afterAll(async () => {
    await client?.close();
  });

  it('son idempotentes', async () => {
    await expect(runMigrations(url!)).resolves.toBeUndefined();
  });

  it('crean las extensiones pg_trgm y unaccent', async () => {
    const rows = await client.sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('pg_trgm', 'unaccent') order by extname`;
    expect(rows.map((r) => r.extname)).toEqual(['pg_trgm', 'unaccent']);
  });

  it('crean merchants con slug único', async () => {
    const slug = `test-${Date.now()}`;
    await client.db
      .insert(merchants)
      .values({ slug, name: 'Tienda Ficticia', sourceType: 'manual' });
    await expect(
      client.db.insert(merchants).values({ slug, name: 'Otra', sourceType: 'manual' }),
    ).rejects.toThrow();
    await client.db.delete(merchants).where(eq(merchants.slug, slug));
  });

  it('crean todas las tablas de §6', async () => {
    const rows = await client.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'ai_comparisons',
        'brands',
        'categories',
        'favorites',
        'match_reviews',
        'merchants',
        'offers',
        'outbound_clicks',
        'price_alerts',
        'price_history',
        'product_variants',
        'products',
        'provider_sync_runs',
        'quarantined_records',
        'search_queries',
        'users',
      ]),
    );
  });

  it('offers: único (merchant_id, external_id) y precio positivo', async () => {
    const slug = `test-offers-${Date.now()}`;
    const [m] = await client.db
      .insert(merchants)
      .values({ slug, name: 'Tienda Ficticia', sourceType: 'manual' })
      .returning();
    const base = { merchantId: m!.id, titleRaw: 'x', url: 'https://t.example/p/1' };
    await client.db.insert(offers).values({ ...base, externalId: 'A', price: 1000 });
    await expect(
      client.db.insert(offers).values({ ...base, externalId: 'A', price: 2000 }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(offers).values({ ...base, externalId: 'B', price: 0 }),
    ).rejects.toThrow();
    await expect(
      client.db.insert(offers).values({ ...base, externalId: 'C', price: 1000, listPrice: 900 }),
    ).rejects.toThrow();
    await client.db.delete(merchants).where(eq(merchants.id, m!.id));
  });

  it('products.search_tsv se genera en español y sin tildes; gtin único si no es nulo', async () => {
    const [p] = await client.db
      .insert(products)
      .values({ canonicalName: 'Nevecón Ártico 300 L', modelNumber: 'BCD205' })
      .returning();
    const [row] = await client.sql<{ match: boolean }[]>`
      select search_tsv @@ plainto_tsquery('spanish', 'nevecon artico bcd205') as match
      from products where id = ${p!.id}`;
    expect(row!.match).toBe(true);

    await client.db.insert(productVariants).values([{ productId: p!.id }, { productId: p!.id }]);
    const gtin = `2${String(Date.now()).slice(-12)}`;
    await client.db.insert(productVariants).values({ productId: p!.id, gtin });
    await expect(
      client.db.insert(productVariants).values({ productId: p!.id, gtin }),
    ).rejects.toThrow();
    await client.db.delete(products).where(eq(products.id, p!.id));
  });

  it('offers.product_id sigue a la variante (insert, cambio, fusión y borrado)', async () => {
    const [m] = await client.db
      .insert(merchants)
      .values({ slug: `test-pid-${Date.now()}`, name: 'Tienda Ficticia', sourceType: 'manual' })
      .returning();
    const [p1, p2] = await client.db
      .insert(products)
      .values([{ canonicalName: 'Producto Uno' }, { canonicalName: 'Producto Dos' }])
      .returning();
    const [v1, v2] = await client.db
      .insert(productVariants)
      .values([{ productId: p1!.id }, { productId: p2!.id }])
      .returning();
    const productOf = async (id: string) =>
      (await client.db.select().from(offers).where(eq(offers.id, id)))[0]!.productId;

    // Escribir product_id a mano no tiene efecto: manda la variante.
    const [o] = await client.db
      .insert(offers)
      .values({
        merchantId: m!.id,
        externalId: 'PID',
        titleRaw: 'x',
        url: 'https://t.example/p/pid',
        price: 1000,
        variantId: v1!.id,
        productId: p2!.id,
      })
      .returning();
    expect(await productOf(o!.id)).toBe(p1!.id);

    await client.db.update(offers).set({ variantId: v2!.id }).where(eq(offers.id, o!.id));
    expect(await productOf(o!.id)).toBe(p2!.id);

    await client.db
      .update(productVariants)
      .set({ productId: p1!.id })
      .where(eq(productVariants.id, v2!.id));
    expect(await productOf(o!.id)).toBe(p1!.id);

    await client.db.delete(productVariants).where(eq(productVariants.id, v2!.id));
    expect(await productOf(o!.id)).toBeNull();

    await client.db.delete(merchants).where(eq(merchants.id, m!.id));
    await client.db.delete(products).where(eq(products.id, p1!.id));
    await client.db.delete(products).where(eq(products.id, p2!.id));
  });
});
