import { FRESHNESS_HIDDEN_HOURS } from '@encuanto/contracts';
import { outboundClicks, type DbClient } from '@encuanto/db';

/** Destino de un clic de salida: la URL de la tienda, con plantilla de afiliado si existe. */
export interface OutboundTarget {
  offerId: string;
  url: string;
}

/**
 * Aplica `merchants.affiliate_template` (§6): `{url}` se sustituye por la URL de la oferta
 * codificada. Solo se aceptan destinos http(s); cualquier otra cosa devuelve `null`.
 */
export function buildOutboundUrl(offerUrl: string, template: string | null): string | null {
  const target = template ? template.split('{url}').join(encodeURIComponent(offerUrl)) : offerUrl;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/**
 * Oferta vigente a la que se puede redirigir: tienda activa y vista hace ≤ 72 h (§8.5).
 * Una oferta oculta en la web tampoco se sirve por `/go`.
 */
export async function findOutboundTarget(
  client: DbClient,
  offerId: string,
): Promise<OutboundTarget | null> {
  const [row] = await client.sql<{ url: string; affiliate_template: string | null }[]>`
    select o.url, m.affiliate_template
      from offers o
      join merchants m on m.id = o.merchant_id
     where o.id = ${offerId}
       and m.active
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})`;
  if (!row) return null;
  const url = buildOutboundUrl(row.url, row.affiliate_template);
  return url ? { offerId, url } : null;
}

/**
 * Registra el clic (§6 `outbound_clicks`). Sin usuario ni `session_hash` hasta H4 (cookie de
 * dispositivo): no se guarda IP ni nada que identifique a quien hace clic.
 */
export async function recordClick(client: DbClient, offerId: string): Promise<void> {
  await client.db.insert(outboundClicks).values({ offerId });
}
