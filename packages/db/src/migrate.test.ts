import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbClient } from './client';
import { runMigrations } from './migrate';
import { merchants } from './schema';

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
});
