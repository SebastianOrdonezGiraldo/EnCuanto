import type { SearchResult } from '@encuanto/contracts';
import { verifiedAgo } from '@/lib/freshness';
import { formatCOP } from '@/lib/format';

/**
 * Ficha de un resultado: "desde $X en N tiendas", mejor oferta con su frescura (§4.6, §8.5) y
 * salida a la tienda por /go (CU‑4). Todo el texto llega escapado por React.
 */
export function ResultCard({ result, now }: { result: SearchResult; now: Date }) {
  const offer = result.best_offer;
  const stores = result.merchant_count === 1 ? '1 tienda' : `${result.merchant_count} tiendas`;
  const initial = (result.brand ?? result.name).charAt(0).toUpperCase();
  return (
    <article
      data-testid="result"
      className="flex flex-col gap-3 rounded-2xl border border-ink-900/10 bg-white p-4 text-ink-900 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-display text-2xl font-bold text-brand-600"
        >
          {initial}
        </div>
        <div className="min-w-0">
          <h3 className="font-sans text-base leading-snug font-semibold" data-testid="result-name">
            {result.name}
          </h3>
          <p className="text-sm text-ink-500">
            {[result.brand, result.category?.name].filter(Boolean).join(' · ')}
            {result.variant_count > 1 ? ` · ${result.variant_count} versiones` : ''}
          </p>
        </div>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className="price text-2xl font-bold"
          data-testid="result-price"
          data-price={result.min_price}
        >
          Desde {formatCOP(result.min_price)}
        </span>
        <span className="text-sm text-ink-500">en {stores}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          Mejor precio en <strong data-testid="result-merchant">{offer.merchant_name}</strong>
        </span>
        {offer.discount_pct !== null ? (
          <span className="rounded-md bg-maiz-400 px-2 py-0.5 font-semibold">
            −{String(offer.discount_pct).replace('.', ',')} %
            <span className="sr-only">, descuento informado por la tienda</span>
          </span>
        ) : null}
        {!offer.in_stock ? (
          <span className="font-semibold text-error-700">Agotado o sin confirmar</span>
        ) : null}
      </div>
      {offer.discount_pct !== null && !offer.discount_validated ? (
        <p className="text-xs text-ink-500" aria-hidden="true">
          Descuento informado por la tienda
        </p>
      ) : null}

      <p className="text-xs text-ink-500">
        Precio verificado {verifiedAgo(offer.last_seen_at, now)}
        {offer.stale ? (
          <span className="font-semibold text-warn-700"> · puede haber cambiado</span>
        ) : null}
      </p>

      <a
        href={`/go/${offer.offer_id}`}
        rel="nofollow noopener"
        className="mt-auto rounded-xl bg-brand-600 px-4 py-2 text-center font-semibold text-white hover:bg-brand-600/90"
      >
        Ver en {offer.merchant_name}
      </a>
    </article>
  );
}
