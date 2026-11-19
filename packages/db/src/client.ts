import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface DbOptions {
  /** Máximo de conexiones del pool. */
  max?: number;
}

/** Crea el cliente de PostgreSQL y la instancia de Drizzle. Quien lo crea debe cerrarlo con `close()`. */
export function createDb(url: string, options: DbOptions = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return {
    db,
    sql,
    /** Comprueba la conexión con `select 1`. */
    async ping(): Promise<void> {
      await sql`select 1`;
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

export type DbClient = ReturnType<typeof createDb>;
export type Database = DbClient['db'];
