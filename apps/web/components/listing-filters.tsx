import type { Facets } from '@encuanto/contracts';
import { formatCOP } from '@/lib/format';
import { hasFilters, hrefFor, type ListingState } from '@/lib/listing-params';

interface Props {
  path: string;
  state: ListingState;
  facets: Facets;
  /** En el listado de una tienda la tienda es fija: no se muestra su faceta. */
  showMerchants?: boolean;
}

/**
 * Filtros como formulario GET: funcionan sin JavaScript y dejan el estado en la URL (§11).
 * Aplicar filtros vuelve a la página 1 y conserva la consulta y el orden.
 */
export function ListingFilters({ path, state, facets, showMerchants = true }: Props) {
  return (
    <form action={path} method="get" className="flex flex-col gap-5" aria-label="Filtros">
      {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
      {state.sort !== 'relevance' ? <input type="hidden" name="sort" value={state.sort} /> : null}

      {showMerchants && facets.merchants.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">Tienda</legend>
          {facets.merchants.map((m) => (
            <label key={m.slug} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="merchants"
                value={m.slug}
                defaultChecked={state.merchants.includes(m.slug)}
                className="size-4 accent-brand-600"
              />
              <span>{m.name}</span>
              <span className="text-ink-500 dark:text-night-text/70">({m.count})</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {facets.brands.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">Marca</legend>
          {facets.brands.map((b) => (
            <label key={b.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="brands"
                value={b.name}
                defaultChecked={state.brands.some((x) => x.toLowerCase() === b.name.toLowerCase())}
                className="size-4 accent-brand-600"
              />
              <span>{b.name}</span>
              <span className="text-ink-500 dark:text-night-text/70">({b.count})</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Precio</legend>
        <div className="flex items-center gap-2">
          <label className="flex flex-col text-sm">
            Desde
            <input
              type="number"
              name="min_price"
              min={0}
              step={1000}
              inputMode="numeric"
              defaultValue={state.minPrice}
              placeholder={facets.price ? formatCOP(facets.price.min) : undefined}
              className="w-32 rounded-lg border border-ink-900/20 bg-white px-2 py-1 text-ink-900"
            />
          </label>
          <label className="flex flex-col text-sm">
            Hasta
            <input
              type="number"
              name="max_price"
              min={0}
              step={1000}
              inputMode="numeric"
              defaultValue={state.maxPrice}
              placeholder={facets.price ? formatCOP(facets.price.max) : undefined}
              className="w-32 rounded-lg border border-ink-900/20 bg-white px-2 py-1 text-ink-900"
            />
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-600/90 dark:bg-brand-300 dark:text-night"
        >
          Aplicar filtros
        </button>
        {hasFilters(state) ? (
          <a
            href={hrefFor(path, state, {
              merchants: [],
              brands: [],
              minPrice: undefined,
              maxPrice: undefined,
              page: 1,
            })}
            className="text-sm font-semibold text-brand-600 underline dark:text-brand-300"
          >
            Quitar filtros
          </a>
        ) : null}
      </div>
    </form>
  );
}
