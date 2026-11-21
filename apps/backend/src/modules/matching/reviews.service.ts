import { matchReviews, offers, type DbClient, type Database } from '@encuanto/db';
import { and, eq, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { createVariant, gtinInUse } from '../catalog/index';
import {
  createProductFromOffer,
  flushCatalogInvalidation,
  lockCatalogForMatching,
  requestCatalogInvalidation,
} from './match.service';
import { prepareTitle } from './title';

/** Decisión de una persona sobre una revisión (CU‑9). */
export type ReviewDecision =
  /** La oferta es la variante candidata. */
  | 'accept'
  /** Es la ficha candidata, pero una variante nueva (atributos de la oferta). */
  | 'new_variant'
  /** No es la ficha candidata: se crea una ficha nueva a partir de la oferta. */
  | 'new_product'
  /** No es un producto comparable (combo, repuesto, título basura): no se muestra. */
  | 'discard';

export interface ReviewView {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  reason: string;
  score: number;
  createdAt: Date;
  reviewedAt: Date | null;
  offer: {
    id: string;
    merchant: string;
    titleRaw: string;
    price: number;
    gtin: string | null;
    brand: string | null;
    url: string;
  };
  candidate: {
    variantId: string;
    productId: string;
    productName: string;
    brand: string | null;
    modelNumber: string | null;
    gtin: string | null;
    attributes: Record<string, unknown>;
  };
}

interface ReviewRow extends Record<string, unknown> {
  id: string;
  status: ReviewView['status'];
  reason: string;
  score: number;
  created_at: Date | string;
  reviewed_at: Date | string | null;
  offer_id: string;
  merchant: string;
  title_raw: string;
  price: number;
  offer_gtin: string | null;
  offer_brand: string | null;
  url: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  brand_name: string | null;
  model_number: string | null;
  variant_gtin: string | null;
  attributes: Record<string, unknown>;
}

/** Cola de revisión, la más antigua primero. */
export async function listReviews(
  db: Database,
  options: { status?: ReviewView['status']; limit: number },
): Promise<ReviewView[]> {
  const status = options.status ?? 'pending';
  const rows = await db.execute<ReviewRow>(sql`
    select r.id, r.status, r.reason, r.score, r.created_at, r.reviewed_at,
           o.id as offer_id, m.slug as merchant, o.title_raw, o.price::float8 as price,
           o.gtin as offer_gtin, o.brand as offer_brand, o.url,
           v.id as variant_id, p.id as product_id, p.canonical_name as product_name,
           b.name as brand_name, p.model_number, v.gtin as variant_gtin, v.attributes
      from match_reviews r
      join offers o on o.id = r.offer_id
      join merchants m on m.id = o.merchant_id
      join product_variants v on v.id = r.candidate_variant_id
      join products p on p.id = v.product_id
      left join brands b on b.id = p.brand_id
     where r.status = ${status}
     order by r.created_at, r.id
     limit ${options.limit}`);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    score: Number(r.score),
    createdAt: new Date(r.created_at),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
    offer: {
      id: r.offer_id,
      merchant: r.merchant,
      titleRaw: r.title_raw,
      price: Number(r.price),
      gtin: r.offer_gtin,
      brand: r.offer_brand,
      url: r.url,
    },
    candidate: {
      variantId: r.variant_id,
      productId: r.product_id,
      productName: r.product_name,
      brand: r.brand_name,
      modelNumber: r.model_number,
      gtin: r.variant_gtin,
      attributes: r.attributes,
    },
  }));
}

/**
 * Aplica la decisión de una persona sobre una revisión pendiente. La oferta queda `manual` (o
 * `rejected` si se descarta) y el matching automático ya no la toca, salvo que la fuente cambie su
 * título, GTIN o marca (entonces vuelve a `pending`). Devuelve la variante asignada o null.
 *
 * `onCatalogChanged` sube la versión de catálogo cuando la oferta pasa a verse en una ficha. Si
 * falla, la invalidación queda pendiente en `catalog_invalidations` y la reintenta el matching.
 */
export async function resolveReview(
  client: DbClient,
  reviewId: string,
  decision: ReviewDecision,
  onCatalogChanged?: () => Promise<void>,
): Promise<{ variantId: string | null }> {
  const variantId = await client.db.transaction(async (tx) => {
    await lockCatalogForMatching(tx);
    // Mismo orden de bloqueo que la ingesta (la oferta y luego su revisión, que borra el trigger
    // `offers_reset_match`): al revés, un sync concurrente y esta petición se bloquean mutuamente.
    const [target] = await tx.execute<{ offer_id: string }>(sql`
      select offer_id from match_reviews where id = ${reviewId}`);
    if (!target) throw new NotFoundError('Revisión no encontrada');
    const [offer] = await tx.execute<{
      id: string;
      title_raw: string;
      gtin: string | null;
      brand: string | null;
      image_url: string | null;
      category: string | null;
    }>(sql`
      select id, title_raw, gtin, brand, image_url, category from offers
       where id = ${target.offer_id} for update`);
    const [review] = await tx.execute<{
      id: string;
      status: string;
      offer_id: string;
      candidate_variant_id: string;
      product_id: string;
    }>(sql`
      select r.id, r.status, r.offer_id, r.candidate_variant_id, v.product_id
        from match_reviews r join product_variants v on v.id = r.candidate_variant_id
       where r.id = ${reviewId} for update of r`);
    // Un sync pudo cambiar la oferta mientras se esperaba el bloqueo: el trigger borra la revisión.
    if (!review) throw new ConflictError('La revisión ya no está pendiente');
    if (review.status !== 'pending') throw new ConflictError('La revisión ya está resuelta');
    if (!offer) throw new NotFoundError('Oferta no encontrada');

    let assigned: string | null = null;
    const title = prepareTitle(offer.title_raw);
    // Con `gtin_conflicto` el GTIN de la oferta ya es de la candidata: la tienda lo puso mal y la
    // variante o la ficha nuevas quedan sin él (es único).
    const gtin = (await gtinInUse(tx, offer.gtin)) ? null : offer.gtin;
    if (decision === 'accept') {
      assigned = review.candidate_variant_id;
    } else if (decision === 'new_variant') {
      assigned = await createVariant(tx, {
        productId: review.product_id,
        gtin,
        attributes: title.attributes,
        imageUrl: offer.image_url,
      });
    } else if (decision === 'new_product') {
      assigned = await createProductFromOffer(tx, { ...offer, gtin }, title);
    }

    await tx
      .update(offers)
      .set({
        variantId: assigned,
        matchStatus: assigned ? 'manual' : 'rejected',
        matchConfidence: assigned ? 1 : null,
        matchLevel: null,
      })
      .where(eq(offers.id, offer.id));
    await tx
      .update(matchReviews)
      .set({
        status: decision === 'accept' ? 'accepted' : 'rejected',
        reviewedAt: sql`now()`,
      })
      .where(and(eq(matchReviews.id, review.id), eq(matchReviews.status, 'pending')));
    // La oferta pasa a verse en una ficha: invalidación pendiente, confirmada con la decisión.
    if (assigned) await requestCatalogInvalidation(tx);
    return assigned;
  });
  // Si falla, la marca sigue y la recupera la siguiente ejecución del matching.
  await flushCatalogInvalidation({ db: client, onCatalogChanged });
  return { variantId };
}
