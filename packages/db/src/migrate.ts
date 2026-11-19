import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Aplica las migraciones pendientes (solo hacia adelante, §13). */
export async function runMigrations(url: string): Promise<void> {
  const client = createDb(url, { max: 1 });
  try {
    await migrate(client.db, { migrationsFolder });
  } finally {
    await client.close();
  }
}
