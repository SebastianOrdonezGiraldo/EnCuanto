import type { ProductOffer, ProductResponse } from '@encuanto/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UnavailableNotice } from '@/components/listing-view';
import { SearchForm } from '@/components/search-form';
import { ApiError, getProduct } from '@/lib/api';
import { formatCOP, variantLabel } from '@/lib/format';
import { verifiedAgo } from '@/lib/freshness';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variante?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function load(id: string): Promise<ProductResponse | null> {
  if (!UUID.test(id)) notFound();
  try {
    return await getProduct(id);
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'not_found') notFound();
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id);
  if (!data) return { title: 'Producto' };
  return {
    title: `${data.product.name}: precios`,
    description: `Compara ${data.product.name} en ${data.merchant_count} ${
      data.merchant_count === 1 ? 'tienda' : 'tiendas'
    }, desde ${formatCOP(data.min_price)}.`,
    alternates: { canonical: `/producto/${id}` },
  };
}

const CONDITION: Record<ProductOffer['condition'], string | null> = {
  new: null,
  used: 'Usado',
  refurbished: 'Reacondicionado',
};

function OfferRow({ offer, now }: { offer: ProductOffer; now: Date }) {
  const condition = CONDITION[offer.condition];
  return (
    <li
      data-testid="offer"
      className="flex flex-col gap-3 rounded-2xl border border-ink-900/10 bg-white p-4 text-ink-900 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold" data-testid="offer-merchant">
          {offer.merchant_name}
          {offer.is_marketplace && offer.seller_name ? (
            <span className="font-normal text-ink-500"> · vendido por {offer.seller_name}</span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span
            className="price text-2xl font-bold"
            data-testid="offer-price"
            data-price={offer.price}
          >
            {formatCOP(offer.price)}
          </span>
          {offer.discount_pct !== null ? (
            <span className="text-sm text-ink-500">
              antes {formatCOP(offer.list_price!)} · −{String(offer.discount_pct).replace('.', ',')}{' '}
              % informado por la tienda
            </span>
          ) : null}
        </p>
        <p className="flex flex-wrap gap-x-3 text-sm">
          {!offer.in_stock ? (
            <span className="font-semibold text-error-700">
              {offer.availability === 'out_of_stock' ? 'Agotado' : 'Disponibilidad sin confirmar'}
            </span>
          ) : null}
          {condition ? <span className="font-semibold">{condition}</span> : null}
        </p>
        <p className="text-xs text-ink-500">
          Precio verificado {verifiedAgo(offer.last_seen_at, now)}
          {offer.stale ? (
            <span className="font-semibold text-warn-700"> · puede haber cambiado</span>
          ) : null}
        </p>
      </div>
      <a
        href={`/go/${offer.offer_id}`}
        rel="nofollow noopener"
        className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-center font-semibold text-white hover:bg-brand-600/90"
      >
        Ir a {offer.merchant_name}
      </a>
    </li>
  );
}

/**
 * Ficha de producto SSR (§6, §11, H3): selector de variante (en la URL, `?variante=`) y ofertas
 * vigentes de la variante, primero las que se pueden comprar, por precio. Sin JavaScript.
 */
export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const raw = (await searchParams).variante;
  const data = await load(id);
  if (!data) {
    return (
      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <SearchForm />
        <UnavailableNotice />
      </section>
    );
  }
  const wanted = typeof raw === 'string' ? raw : undefined;
  const selected = data.variants.find((v) => v.variant_id === wanted) ?? data.variants[0]!;
  const { product } = data;
  const now = new Date();
  const stores = data.merchant_count === 1 ? '1 tienda' : `${data.merchant_count} tiendas`;
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <SearchForm />
      <header className="flex flex-col gap-2">
        <p className="text-sm text-ink-500 dark:text-night-text/80">
          {product.category ? (
            <a
              href={`/categoria/${product.category.slug}`}
              className="font-semibold text-brand-600 underline dark:text-brand-300"
            >
              {product.category.name}
            </a>
          ) : null}
          {[product.brand, product.model_number ? `Modelo ${product.model_number}` : null]
            .filter(Boolean)
            .map((t) => ` · ${t}`)
            .join('')}
        </p>
        <h1 className="text-2xl font-bold sm:text-3xl" data-testid="product-name">
          {product.name}
        </h1>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="price text-2xl font-bold" data-testid="product-min-price">
            Desde {formatCOP(data.min_price)}
          </span>
          <span className="text-sm text-ink-500 dark:text-night-text/80">en {stores}</span>
        </p>
      </header>

      {data.variants.length > 1 ? (
        <nav aria-label="Versiones" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Versiones</h2>
          <ul className="flex flex-wrap gap-2">
            {data.variants.map((v) => {
              const current = v.variant_id === selected.variant_id;
              return (
                <li key={v.variant_id}>
                  <a
                    href={`/producto/${product.id}?variante=${v.variant_id}`}
                    aria-current={current ? 'true' : undefined}
                    data-testid="variant"
                    className={`flex flex-col rounded-xl border px-3 py-2 text-sm ${
                      current
                        ? 'border-brand-600 bg-brand-50 font-semibold text-ink-900'
                        : 'border-ink-900/15 hover:border-brand-600 dark:border-night-text/30'
                    }`}
                  >
                    <span>{variantLabel(v.attributes)}</span>
                    <span className="text-xs">desde {formatCOP(v.min_price)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold" data-testid="variant-heading">
          {variantLabel(selected.attributes)}:{' '}
          {selected.offer_count === 1 ? '1 oferta' : `${selected.offer_count} ofertas`}
        </h2>
        <ul className="flex flex-col gap-3">
          {selected.offers.map((o) => (
            <OfferRow key={o.offer_id} offer={o} now={now} />
          ))}
        </ul>
        <p className="text-xs text-ink-500 dark:text-night-text/80">
          Los descuentos los informa cada tienda; todavía no los validamos con el historial de
          precios.
        </p>
      </div>
    </section>
  );
}
