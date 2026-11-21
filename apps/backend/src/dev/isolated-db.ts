import { createDb, runMigrations } from '@encuanto/db';
import { randomBytes } from 'node:crypto';

export interface IsolatedDatabase {
  url: string;
  name: string;
  drop(): Promise<void>;
}

/**
 * Crea una base de datos aparte en el mismo servidor de `baseUrl`, con las migraciones
 * aplicadas. La usan el benchmark de búsqueda y los tests que necesitan un catálogo exacto
 * (los productos no llevan prefijo de test y la búsqueda ve todo el catálogo).
 * Necesita permiso CREATEDB (el usuario de docker-compose y del CI lo tiene).
 */
export async function createIsolatedDatabase(
  baseUrl: string,
  label: string,
  options: { name?: string; reuse?: boolean } = {},
): Promise<IsolatedDatabase> {
  const name =
    options.name ?? `encuanto_${label.replace(/[^a-z0-9]/g, '')}_${randomBytes(4).toString('hex')}`;
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error('Nombre de base de datos inválido');
  const admin = createDb(baseUrl, { max: 1 });
  try {
    const [exists] = await admin.sql`select 1 from pg_database where datname = ${name}`;
    if (exists && !options.reuse) await admin.sql.unsafe(`drop database "${name}" with (force)`);
    if (!exists || !options.reuse) await admin.sql.unsafe(`create database "${name}"`);
  } finally {
    await admin.close();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return {
    url: url.toString(),
    name,
    async drop() {
      const conn = createDb(baseUrl, { max: 1 });
      try {
        await conn.sql.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await conn.close();
      }
    },
  };
}
