import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface DbOptions {
  /** Máximo de conexiones del pool. */
  max?: number;
  /** Segundos para establecer la conexión antes de fallar. */
  connectTimeout?: number;
}

/** Crea el cliente de PostgreSQL y la instancia de Drizzle. Quien lo crea debe cerrarlo con `close()`. */
export function createDb(url: string, options: DbOptions = {}) {
  const sql = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeout ?? 5,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return {
    db,
    sql,
    /** Comprueba la conexión con `select 1`. Si se aborta `signal`, cancela la consulta en el servidor. */
    async ping(signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted();
      const query = sql`select 1`.execute();
      const onAbort = () => void query.cancel();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await query;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

export type DbClient = ReturnType<typeof createDb>;
export type Database = DbClient['db'];

/** Transacción de Drizzle (`db.transaction(async (tx) => …)`). */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Algo sobre lo que ejecutar consultas: la BD o una transacción abierta. */
export type DbExecutor = Database | DbTransaction;
