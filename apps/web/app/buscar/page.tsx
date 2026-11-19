import type { Metadata } from 'next';
import { SearchForm } from '@/components/search-form';

export const metadata: Metadata = { title: 'Buscar' };

interface Props {
  searchParams: Promise<{ q?: string | string[] }>;
}

// Marcador hasta H2: la búsqueda real (/api/search) aún no existe.
export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.slice(0, 100) ?? '';
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12">
      <SearchForm defaultValue={query} />
      <p className="text-ink-500 dark:text-night-text/80">
        {query ? <>Todavía no podemos buscar «{query}». </> : null}
        Estamos conectando las primeras tiendas; la búsqueda llega muy pronto.
      </p>
    </section>
  );
}
