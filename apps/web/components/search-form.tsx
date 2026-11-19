/** Formulario de búsqueda. Envía por GET para que la consulta quede en la URL (§11). */
export function SearchForm({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action="/buscar" method="get" role="search" className="flex w-full max-w-2xl gap-2">
      <label htmlFor="q" className="sr-only">
        ¿Qué quieres comprar?
      </label>
      <input
        id="q"
        name="q"
        type="search"
        required
        minLength={2}
        maxLength={100}
        defaultValue={defaultValue}
        placeholder="Ej.: nevera no frost 300 litros"
        className="min-w-0 flex-1 rounded-xl border border-ink-900/20 bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-500 dark:border-night-text/20"
      />
      <button
        type="submit"
        className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-600/90 dark:bg-brand-300 dark:text-night"
      >
        Buscar
      </button>
    </form>
  );
}
