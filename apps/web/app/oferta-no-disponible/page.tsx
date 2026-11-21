import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Oferta no disponible', robots: { index: false } };

export default function OfferUnavailable() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Esta oferta ya no está disponible</h1>
      <p className="text-ink-500 dark:text-night-text/80">
        La tienda dejó de publicarla o hace más de tres días que no podemos confirmar su precio.
      </p>
      <Link href="/" className="font-semibold text-brand-600 underline dark:text-brand-300">
        Buscar de nuevo
      </Link>
    </section>
  );
}
