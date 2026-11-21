import {
  FRESHNESS_HIDDEN_HOURS,
  freshnessOf,
  type ProductOffer,
  type ProductResponse,
  type ProductVariant,
} from '@encuanto/contracts';
import type { DbClient, VariantAttributes } from '@encuanto/db';
import { discountPct } from './rank';

type Sql = DbClient['sql'];

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  model_number: string | null;
  category_slug: string | null;
  category_name: string | null;
}

interface OfferRow {
  variant_id: string;
  gtin: string | null;
  attributes: VariantAttributes;
  variant_image: string | null;
  offer_id: string;
  merchant: string;
  merchant_name: string;
  price: number;
  list_price: number | null;
  availability: ProductOffer['availability'];
  condition: ProductOffer['condition'];
  is_marketplace: boolean;
  seller_name: string | null;
  image_url: string | null;
  last_seen_at: Date | string;
}

/** Comprable: en stock, en preventa o sin confirmar (como en los listados, §8.3). */
const buyable = (o: ProductOffer) => o.availability !== 'out_of_stock';

function byBuyableThenPrice(a: ProductOffer, b: ProductOffer): number {
  return (
    Number(!buyable(a)) - Number(!buyable(b)) ||
    a.price - b.price ||
    new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime() ||
    (a.offer_id < b.offer_id ? -1 : 1)
  );
}

/**
 * Ficha de producto (§7, H3): variantes con sus ofertas vigentes (§8.5: tienda activa, en COP y
 * vistas hace ≤ 72 h). `null` si el producto no existe o no tiene ninguna oferta vigente: una
 * ficha vacía no se muestra (tampoco aparece en los listados).
 */
export async function getProductPage(
  sql: Sql,
  productId: string,
  now: Date,
): Promise<ProductResponse | null> {
  const [product] = await sql<ProductRow[]>`
    select p.id, p.canonical_name as name, b.name as brand, p.model_number,
           c.slug as category_slug, c.name as category_name
      from products p
      left join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
     where p.id = ${productId}`;
  if (!product) return null;

  const rows = await sql<OfferRow[]>`
    select v.id as variant_id, v.gtin, v.attributes, v.image_url as variant_image,
           o.id as offer_id, m.slug as merchant, m.name as merchant_name,
           o.price::float8 as price, o.list_price::float8 as list_price, o.availability,
           o.condition, o.is_marketplace, o.seller_name, o.image_url, o.last_seen_at
      from offers o
      join product_variants v on v.id = o.variant_id
      join merchants m on m.id = o.merchant_id
     where o.product_id = ${productId}
       and m.active
       and o.currency = 'COP'
       and o.last_seen_at > now() - make_interval(hours => ${FRESHNESS_HIDDEN_HOURS})
     order by v.created_at, v.id`;

  const variants = new Map<string, ProductVariant & { image: string | null }>();
  for (const r of rows) {
    const freshness = freshnessOf(r.last_seen_at, now);
    if (freshness === 'hidden') continue;
    let variant = variants.get(r.variant_id);
    if (!variant) {
      variant = {
        variant_id: r.variant_id,
        gtin: r.gtin,
        attributes: r.attributes,
        image_url: r.variant_image,
        image: r.variant_image ?? r.image_url,
        offer_count: 0,
        merchant_count: 0,
        min_price: 0,
        offers: [],
      };
      variants.set(r.variant_id, variant);
    }
    const price = Number(r.price);
    const listPrice = r.list_price === null ? null : Number(r.list_price);
    variant.offers.push({
      offer_id: r.offer_id,
      merchant: r.merchant,
      merchant_name: r.merchant_name,
      price,
      list_price: listPrice,
      discount_pct: discountPct(price, listPrice),
      discount_validated: false,
      availability: r.availability,
      in_stock: r.availability === 'in_stock',
      condition: r.condition,
      is_marketplace: r.is_marketplace,
      seller_name: r.seller_name,
      last_seen_at: new Date(r.last_seen_at).toISOString(),
      stale: freshness === 'stale',
    });
  }
  if (variants.size === 0) return null;

  const list = [...variants.values()].map((v) => {
    const offers = [...v.offers].sort(byBuyableThenPrice);
    const candidates = offers.some(buyable) ? offers.filter(buyable) : offers;
    return {
      ...v,
      offers,
      offer_count: offers.length,
      merchant_count: new Set(offers.map((o) => o.merchant)).size,
      min_price: Math.min(...candidates.map((o) => o.price)),
      hasBuyable: offers.some(buyable),
    };
  });
  list.sort(
    (a, b) =>
      Number(!a.hasBuyable) - Number(!b.hasBuyable) ||
      a.min_price - b.min_price ||
      (a.variant_id < b.variant_id ? -1 : 1),
  );
  const all = list.flatMap((v) => v.offers);
  const pool = all.some(buyable) ? all.filter(buyable) : all;
  return {
    product: {
      id: product.id,
      name: product.name,
      brand: product.brand,
      model_number: product.model_number,
      category:
        product.category_slug && product.category_name
          ? { slug: product.category_slug, name: product.category_name }
          : null,
      image_url: list.find((v) => v.image_url)?.image_url ?? list[0]!.image ?? null,
    },
    variants: list.map(({ image: _image, hasBuyable: _hasBuyable, ...v }) => v),
    offer_count: all.length,
    merchant_count: new Set(all.map((o) => o.merchant)).size,
    min_price: Math.min(...pool.map((o) => o.price)),
    max_price: Math.max(...pool.map((o) => o.price)),
  };
}
