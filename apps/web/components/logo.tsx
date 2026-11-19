/** Logo horizontal con variante clara y oscura según prefers-color-scheme. */
export function Logo({ className = 'h-9 w-auto' }: { className?: string }) {
  return (
    <picture>
      <source srcSet="/brand/logo-oscuro.svg" media="(prefers-color-scheme: dark)" />
      <img
        src="/brand/logo-claro.svg"
        alt="¿EnCuánto?"
        width={474}
        height={140}
        className={className}
      />
    </picture>
  );
}
