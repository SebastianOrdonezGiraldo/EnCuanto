import { SEARCH_SORTS, type Facets, type SearchResult, type SearchSort } from '@encuanto/contracts';
import type { ReactNode } from 'react';
import { hrefFor, type ListingState } from '@/lib/listing-params';
import { ListingFilters } from './listing-filters';
import { ResultCard } from './result-card';

export const PAGE_SIZE = 24;

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Relevancia',
  price_asc: 'Menor precio',
  price_desc: 'Mayor precio',
  discount: 'Mayor descuento',
};

interface Props {
  path: string;
  state: ListingState;
  total: number;
  results: SearchResult[];
  facets: Facets;
  showMerchantFacet?: boolean;
  /** Qué mostrar si no hay resultados. */
  empty: ReactNode;
}

/** Resultados, filtros, orden y paginación compartidos por búsqueda, tienda y categoría. */
export function ListingView({
  path,
  state,
  total,
  results,
  facets,
  showMerchantFacet = true,
  empty,
}: Props) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = new Date();
  return (
    <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
      {/* En móvil los resultados van primero y los filtros debajo (con un enlace para saltar). */}
      <aside id="filtros" className="order-last md:order-first">
        <ListingFilters
          path={path}
          state={state}
          facets={facets}
          showMerchants={showMerchantFacet}
        />
      </aside>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className="text-sm text-ink-500 dark:text-night-text/80"
            data-testid="total"
            role="status"
          >
            {total === 1 ? '1 producto' : `${total.toLocaleString('es-CO')} productos`}
            <a
              href="#filtros"
              className="ml-3 font-semibold text-brand-600 underline md:hidden dark:text-brand-300"
            >
              Filtrar
            </a>
          </p>
          <nav aria-label="Ordenar por" className="flex flex-wrap gap-2 text-sm">
            {SEARCH_SORTS.map((sort) => (
              <a
                key={sort}
                href={hrefFor(path, state, { sort, page: 1 })}
                aria-current={state.sort === sort ? 'true' : undefined}
                className={
                  state.sort === sort
                    ? 'rounded-full bg-ink-900 px-3 py-1 font-semibold text-white dark:bg-night-text dark:text-night'
                    : 'rounded-full border border-ink-900/20 px-3 py-1 hover:bg-ink-900/5 dark:border-night-text/20'
                }
              >
                {SORT_LABELS[sort]}
              </a>
            ))}
          </nav>
        </div>

        {results.length === 0 ? (
          <div
            data-testid="empty"
            className="rounded-2xl border border-dashed border-ink-900/20 p-8 dark:border-night-text/20"
          >
            {empty}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((r) => (
              <li key={r.product_id} className="flex">
                <ResultCard result={r} now={now} />
              </li>
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <nav aria-label="Páginas" className="flex items-center justify-center gap-4">
            {state.page > 1 ? (
              <a
                href={hrefFor(path, state, { page: state.page - 1 })}
                rel="prev"
                className="font-semibold underline"
              >
                Anterior
              </a>
            ) : null}
            <span className="text-sm">
              Página {state.page} de {pages}
            </span>
            {state.page < pages ? (
              <a
                href={hrefFor(path, state, { page: state.page + 1 })}
                rel="next"
                className="font-semibold underline"
              >
                Siguiente
              </a>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

export function UnavailableNotice() {
  return (
    <p role="alert" className="rounded-2xl bg-white p-6 text-ink-900">
      No pudimos cargar los precios en este momento. Intenta de nuevo en unos minutos.
    </p>
  );
}
