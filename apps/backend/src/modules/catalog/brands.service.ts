import { brands, type Database } from '@encuanto/db';
import { brandKey } from '../normalization/index';

/** Nombres normalizados de las marcas conocidas, para el diccionario de normalización (§8.1.2). */
export async function loadBrandNames(db: Database): Promise<string[]> {
  const rows = await db.select({ name: brands.normalizedName }).from(brands);
  return rows.map((r) => r.name);
}

/** Registra marcas (idempotente). Devuelve cuántas eran nuevas. */
export async function upsertBrands(db: Database, names: readonly string[]): Promise<number> {
  const values = [...new Map(names.map((n) => [brandKey(n), n])).entries()]
    .filter(([key]) => key)
    .map(([normalizedName, name]) => ({ name, normalizedName }));
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(brands)
    .values(values)
    .onConflictDoNothing({ target: brands.normalizedName })
    .returning({ id: brands.id });
  return inserted.length;
}
