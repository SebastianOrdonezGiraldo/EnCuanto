import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Esta página no existe</h1>
      <p className="text-ink-500 dark:text-night-text/80">
        Puede que el enlace esté mal escrito o que la página ya no exista.
      </p>
      <Link href="/" className="font-semibold text-brand-600 underline dark:text-brand-300">
        Volver al inicio
      </Link>
    </section>
  );
}
