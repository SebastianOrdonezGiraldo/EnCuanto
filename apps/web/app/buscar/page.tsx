import type { Metadata } from 'next';
import { ListingView, PAGE_SIZE, UnavailableNotice } from '@/components/listing-view';
import { SearchForm } from '@/components/search-form';
import { ApiError, searchProducts } from '@/lib/api';
import {
  hasFilters,
  hrefFor,
  parseListingParams,
  toApiParams,
  type RawParams,
} from '@/lib/listing-params';

interface Props {
  searchParams: Promise<RawParams>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = parseListingParams(await searchParams);
  return {
    title: q ? `«${q}»` : 'Buscar',
    // Las páginas de resultados no se indexan; sus enlaces sí se siguen.
    robots: { index: false, follow: true },
  };
}

/** Búsqueda SSR (CU‑1, CU‑2): todo el estado vive en la URL. */
export default async function SearchPage({ searchParams }: Props) {
  const state = parseListingParams(await searchParams);
  const query = state.q;

  let content;
  if (query.length < 2) {
    content = (
      <p className="text-ink-500 dark:text-night-text/80">
        Escribe al menos dos letras para buscar, por ejemplo «nevera no frost».
      </p>
    );
  } else {
    try {
      const params = toApiParams(state, PAGE_SIZE);
      params.set('q', query);
      const data = await searchProducts(params);
      content = (
        <>
          <h1 className="text-2xl font-bold sm:text-3xl">Resultados para «{query}»</h1>
          <ListingView
            path="/buscar"
            state={state}
            total={data.total}
            results={data.results}
            facets={data.facets}
            empty={
              <>
                <p className="text-lg font-semibold">No encontramos productos para «{query}».</p>
                <p className="mt-2 text-ink-500 dark:text-night-text/80">
                  Revisa la ortografía o prueba con menos palabras.{' '}
                  {hasFilters(state) ? (
                    <a
                      className="font-semibold text-brand-600 underline dark:text-brand-300"
                      href={hrefFor('/buscar', state, {
                        merchants: [],
                        brands: [],
                        minPrice: undefined,
                        maxPrice: undefined,
                        page: 1,
                      })}
                    >
                      Quitar filtros
                    </a>
                  ) : null}
                </p>
              </>
            }
          />
        </>
      );
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      content = <UnavailableNotice />;
    }
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <SearchForm defaultValue={query} />
      {content}
    </section>
  );
}
