import { merchants, type Database, type Merchant, type NewMerchant } from '@encuanto/db';
import { asc, eq, sql } from 'drizzle-orm';

export async function getMerchantBySlug(db: Database, slug: string): Promise<Merchant | null> {
  const [row] = await db.select().from(merchants).where(eq(merchants.slug, slug)).limit(1);
  return row ?? null;
}

export function listMerchants(db: Database): Promise<Merchant[]> {
  return db.select().from(merchants).orderBy(asc(merchants.slug));
}

/** Comerciantes activos con fuente configurada: los que el worker sincroniza. */
export async function listSyncableMerchants(db: Database): Promise<Merchant[]> {
  const rows = await listMerchants(db);
  return rows.filter((m) => m.active && m.providerConfig !== null);
}

/** Crea o actualiza un comerciante por `slug` (lo usa el seed). */
export async function upsertMerchant(db: Database, data: NewMerchant): Promise<Merchant> {
  const [row] = await db
    .insert(merchants)
    .values(data)
    .onConflictDoUpdate({
      target: merchants.slug,
      set: {
        name: data.name,
        brandColor: data.brandColor ?? null,
        platform: data.platform ?? null,
        sourceType: data.sourceType,
        active: data.active ?? true,
        termsReviewedAt: data.termsReviewedAt ?? null,
        affiliateTemplate: data.affiliateTemplate ?? null,
        providerConfig: data.providerConfig ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row!;
}
