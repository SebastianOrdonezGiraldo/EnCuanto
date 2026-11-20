import { SearchForm } from '@/components/search-form';
import { listCategories } from '@/lib/api';
import { formatCOP } from '@/lib/format';

// Las categorías se refrescan cada 5 minutos; si la API no responde, la portada sale sin ellas.
export const revalidate = 300;

export default async function HomePage() {
  const categories = await listCategories()
    .then((r) => r.categories)
    .catch(() => []);
  return (
    <section className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-16 sm:py-24">
      <h1 className="max-w-3xl text-4xl leading-tight font-extrabold tracking-tight sm:text-6xl">
        Todas las tiendas.{' '}
        <span className="text-brand-600 dark:text-brand-300">Un solo precio: el más bajo.</span>
      </h1>
      <p className="max-w-2xl text-lg text-ink-500 dark:text-night-text/80">
        Busca un producto y te decimos en cuánto está en cada tienda, si el descuento es real y hace
        cuánto verificamos el precio.
      </p>
      <SearchForm />
      <div
        aria-label="Ejemplo de resultado"
        className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 text-ink-900 shadow-sm"
      >
        <span className="rounded-md bg-maiz-400 px-2 py-1 text-sm font-semibold">Mejor precio</span>
        <span className="price text-xl font-bold">Desde {formatCOP(1899900)} en 4 tiendas</span>
        <span className="text-sm text-ink-500">Ejemplo ilustrativo</span>
      </div>
      {categories.length > 0 ? (
        <nav aria-label="Categorías" className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Explora por categoría</h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <a
                  href={`/categoria/${c.slug}`}
                  className="inline-block rounded-full border border-ink-900/20 px-4 py-2 font-semibold hover:bg-brand-50 dark:border-night-text/20 dark:hover:bg-night-text/10"
                >
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}
