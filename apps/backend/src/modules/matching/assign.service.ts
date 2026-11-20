import { type Database } from '@encuanto/db';
import { sql } from 'drizzle-orm';

/** Asignación de una oferta (por comerciante e id externo) a una variante del catálogo. */
export interface VariantAssignment {
  merchantId: string;
  externalId: string;
  variantId: string;
}

const CHUNK = 1000;

/**
 * Asigna ofertas a variantes conocidas con `match_status = 'manual'` y confianza 1.
 * Solo toca las filas que cambian, así que reejecutarlo es idempotente. Devuelve cuántas
 * ofertas cambiaron de variante (si es > 0, quien llama debe subir la versión de catálogo).
 *
 * H2: lo usa el seed sintético, que conoce la ficha de cada oferta. El algoritmo de matching
 * de §8.2 (GTIN, modelo, trigramas, cola de revisión) llega en H3 y escribirá las mismas columnas.
 */
export async function assignVariants(
  db: Database,
  assignments: readonly VariantAssignment[],
): Promise<number> {
  let changed = 0;
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const part = assignments.slice(i, i + CHUNK);
    const values = sql.join(
      part.map((a) => sql`(${a.merchantId}::uuid, ${a.externalId}::text, ${a.variantId}::uuid)`),
      sql`, `,
    );
    const result = await db.execute(sql`
      update offers o
         set variant_id = a.variant_id, match_status = 'manual', match_confidence = 1
        from (values ${values}) as a(merchant_id, external_id, variant_id)
       where o.merchant_id = a.merchant_id
         and o.external_id = a.external_id
         and (o.variant_id is distinct from a.variant_id or o.match_status <> 'manual')`);
    changed += result.count ?? 0;
  }
  return changed;
}
