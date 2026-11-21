import { matchReviews, offers, type DbClient, type DbExecutor } from '@encuanto/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Log } from '../../shared/log';
import {
  createProduct,
  createVariant,
  ensureBrand,
  ensureCategory,
  fillVariantGtin,
} from '../catalog/index';
import { normalizeText } from '../normalization/index';
import { findCandidates } from './candidates.repository';
import { decideMatch, type MatchDecision } from './rules';
import { categoryName, displayName, prepareTitle, type PreparedTitle } from './title';

export interface MatchingDeps {
  db: DbClient;
  log: Log;
  /** Se llama si alguna oferta cambió de ficha (sube la versión de catálogo, §8.6). */
  onCatalogChanged?: () => Promise<void>;
}

export interface MatchingResult {
  /** Ofertas pendientes que se decidieron en esta ejecución. */
  processed: number;
  auto: { level1: number; level2: number; level3: number };
  /** Variantes nuevas de una ficha existente (nivel 2 con atributos nuevos). */
  newVariants: number;
  /** Fichas nuevas creadas a partir de una oferta (nivel 5). */
  newProducts: number;
  /** Ofertas mandadas a la cola de revisión (nivel 4 y casos dudosos). */
  reviews: number;
  /** Variantes a las que el nivel 2 completó el GTIN. */
  gtinsFilled: number;
  /** Ofertas que otra ejecución o la ingesta cambiaron mientras tanto (quedan para la siguiente). */
  skipped: number;
  /** Ofertas cuyo matching falló (quedan pendientes; el error se registra). */
  failed: number;
  /** Ofertas en las que se alcanzó el tope de fichas parecidas (`MAX_SIMILAR_PRODUCTS`). */
  candidatesCapped: number;
}

/** Ofertas que se leen por consulta; se deciden una a una. */
const PAGE = 200;
/** Clave del advisory lock que serializa las decisiones (dos ofertas iguales no crean dos fichas). */
export const MATCHING_LOCK = 'matching:catalog';

interface PendingRow extends Record<string, unknown> {
  id: string;
  seen: string;
}

interface OfferRow extends Record<string, unknown> {
  id: string;
  title_raw: string;
  gtin: string | null;
  brand: string | null;
  image_url: string | null;
  category: string | null;
  variant_id: string | null;
  match_status: string;
}

const emptyResult = (): MatchingResult => ({
  processed: 0,
  auto: { level1: 0, level2: 0, level3: 0 },
  newVariants: 0,
  newProducts: 0,
  reviews: 0,
  gtinsFilled: 0,
  skipped: 0,
  failed: 0,
  candidatesCapped: 0,
});

/**
 * Empareja las ofertas pendientes (§8.2): sin decidir, nuevas o cuyos datos cambiaron (trigger
 * `offers_reset_match`), salvo las que esperan en la cola de revisión. Cada oferta se decide en
 * su propia transacción, con un advisory lock común: varias ejecuciones (varios workers) pueden
 * correr a la vez sin crear dos fichas para el mismo producto. Reejecutarlo sin cambios no hace
 * nada: no quedan pendientes.
 *
 * Recorre las pendientes en orden de llegada, en pasadas sucesivas hasta que una pasada no
 * encuentra ninguna nueva: así entran también las que la ingesta inserta mientras corre.
 */
export async function runMatching(
  deps: MatchingDeps,
  options: { signal?: AbortSignal } = {},
): Promise<MatchingResult> {
  const result = emptyResult();
  const attempted = new Set<string>();
  let catalogChanged = false;
  let found = true;
  while (found) {
    found = false;
    // Orden de llegada (first_seen_at, id): la primera tienda que trae un producto le da nombre
    // a la ficha nueva. La marca de tiempo viaja como texto para no perder los microsegundos.
    let after = { seen: '-infinity', id: '00000000-0000-0000-0000-000000000000' };
    for (;;) {
      options.signal?.throwIfAborted();
      const rows = await deps.db.db.execute<PendingRow>(sql`
        select o.id, o.first_seen_at::text as seen from offers o
         where o.match_status = 'pending'
           and (o.first_seen_at, o.id) > (${after.seen}::timestamptz, ${after.id}::uuid)
           and not exists (select 1 from match_reviews r
                            where r.offer_id = o.id and r.status = 'pending')
         order by o.first_seen_at, o.id
         limit ${PAGE}`);
      if (rows.length === 0) break;
      const last = rows[rows.length - 1]!;
      after = { seen: last.seen, id: last.id };
      for (const { id } of rows) {
        if (attempted.has(id)) continue;
        attempted.add(id);
        found = true;
        options.signal?.throwIfAborted();
        try {
          const outcome = await matchOne(deps.db, id);
          if (!outcome) {
            result.skipped++;
            continue;
          }
          count(result, outcome);
          if (outcome.changed) catalogChanged = true;
        } catch (error) {
          result.failed++;
          deps.log.error(
            { offer_id: id, err: error instanceof Error ? error.message : 'error desconocido' },
            'matching: falló una oferta',
          );
        }
      }
    }
  }
  if (result.candidatesCapped > 0) {
    deps.log.warn(
      { offers: result.candidatesCapped },
      'matching: tope de fichas parecidas alcanzado',
    );
  }
  deps.log.info({ ...result }, 'matching: fin');
  if (catalogChanged && deps.onCatalogChanged) {
    try {
      await deps.onCatalogChanged();
    } catch (error) {
      // La caché de búsqueda caduca sola (TTL, §8.6); no se pierde el trabajo hecho.
      deps.log.warn(
        { err: error instanceof Error ? error.message : 'error desconocido' },
        'matching: no se pudo invalidar la caché del catálogo',
      );
    }
  }
  return result;
}

interface Outcome {
  decision: MatchDecision;
  changed: boolean;
  capped: boolean;
  gtinFilled: boolean;
}

function count(result: MatchingResult, o: Outcome): void {
  result.processed++;
  if (o.capped) result.candidatesCapped++;
  if (o.gtinFilled) result.gtinsFilled++;
  const d = o.decision;
  if (d.kind === 'auto') result.auto[`level${d.level}`]++;
  else if (d.kind === 'new_variant') result.newVariants++;
  else if (d.kind === 'new_product') result.newProducts++;
  else result.reviews++;
}

/** Bloquea el catálogo para decisiones de matching hasta el final de la transacción. */
export async function lockCatalogForMatching(tx: DbExecutor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${MATCHING_LOCK}, 0))`);
}

/** Decide y aplica el matching de una oferta. `null` si ya no está pendiente. */
async function matchOne(client: DbClient, offerId: string): Promise<Outcome | null> {
  return client.db.transaction(async (tx) => {
    await lockCatalogForMatching(tx);
    // Bajo el lock y con la fila bloqueada: si la ingesta la cambia después, el trigger la
    // devuelve a `pending` y se vuelve a decidir con los datos nuevos.
    const [row] = await tx.execute<OfferRow>(sql`
      select id, title_raw, gtin, brand, image_url, category, variant_id, match_status
        from offers where id = ${offerId} for update`);
    if (!row || row.match_status !== 'pending') return null;
    const [open] = await tx.execute(sql`
      select 1 from match_reviews where offer_id = ${offerId} and status = 'pending'`);
    if (open) return null;

    const title = prepareTitle(row.title_raw);
    const offer = { titleRaw: row.title_raw, gtin: row.gtin, brand: row.brand };
    const candidates = await findCandidates(tx, offer, title);
    const decision = decideMatch(offer, candidates);
    const { changed, gtinFilled } = await applyDecision(tx, row, title, decision);
    return { decision, changed, capped: candidates.capped, gtinFilled };
  });
}

async function assign(
  tx: DbExecutor,
  offerId: string,
  variantId: string,
  level: 1 | 2 | 3 | 5,
  confidence: number | null,
): Promise<void> {
  await tx
    .update(offers)
    .set({ variantId, matchStatus: 'auto', matchLevel: level, matchConfidence: confidence })
    .where(eq(offers.id, offerId));
}

/** Nombre de la marca para una ficha nueva: como aparece en el título, o con mayúscula inicial. */
function brandDisplay(titleRaw: string, key: string): string {
  const word = titleRaw.split(/\s+/).find((w) => normalizeText(w) === key);
  if (word && !/^\p{Lu}{4,}$/u.test(word)) return word;
  return key.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** Crea la ficha (producto + variante) de una oferta sin candidato (§8.2 nivel 5). */
export async function createProductFromOffer(
  tx: DbExecutor,
  row: Pick<OfferRow, 'title_raw' | 'gtin' | 'brand' | 'image_url' | 'category'>,
  title: PreparedTitle,
): Promise<string> {
  const brandId = row.brand
    ? await ensureBrand(tx, row.brand, brandDisplay(row.title_raw, row.brand))
    : null;
  const category = categoryName(row.category);
  const categoryId = category ? await ensureCategory(tx, category) : null;
  const productId = await createProduct(tx, {
    brandId,
    categoryId,
    canonicalName: displayName(row.title_raw, title.core, title.modelNumber),
    modelNumber: title.modelNumber,
  });
  return createVariant(tx, {
    productId,
    gtin: row.gtin,
    attributes: title.attributes,
    imageUrl: row.image_url,
  });
}

async function applyDecision(
  tx: DbExecutor,
  row: OfferRow,
  title: PreparedTitle,
  decision: MatchDecision,
): Promise<{ changed: boolean; gtinFilled: boolean }> {
  switch (decision.kind) {
    case 'auto': {
      await assign(tx, row.id, decision.variantId, decision.level, decision.confidence);
      const gtinFilled =
        decision.fillGtin && row.gtin
          ? await fillVariantGtin(tx, decision.variantId, row.gtin)
          : false;
      return { changed: row.variant_id !== decision.variantId, gtinFilled };
    }
    case 'new_variant': {
      const variantId = await createVariant(tx, {
        productId: decision.productId,
        gtin: row.gtin,
        attributes: title.attributes,
        imageUrl: row.image_url,
      });
      await assign(tx, row.id, variantId, 2, decision.confidence);
      return { changed: true, gtinFilled: false };
    }
    case 'new_product': {
      const variantId = await createProductFromOffer(tx, row, title);
      await assign(tx, row.id, variantId, 5, null);
      return { changed: true, gtinFilled: false };
    }
    case 'review': {
      await tx
        .insert(matchReviews)
        .values({
          offerId: row.id,
          candidateVariantId: decision.variantId,
          score: decision.score,
          reason: decision.reason,
        })
        .onConflictDoNothing();
      // En duda, la oferta deja de mostrarse en una ficha hasta que una persona decida.
      await tx
        .update(offers)
        .set({ variantId: null, matchLevel: null, matchConfidence: null })
        .where(and(eq(offers.id, row.id)));
      return { changed: row.variant_id !== null, gtinFilled: false };
    }
  }
}
