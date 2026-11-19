import Link from 'next/link';
import { Logo } from './logo';

export function SiteHeader() {
  return (
    <header className="border-b border-ink-900/10 dark:border-night-text/10">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
        <Link href="/" aria-label="EnCuánto, inicio">
          <Logo />
        </Link>
      </div>
    </header>
  );
}
