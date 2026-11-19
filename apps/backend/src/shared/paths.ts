import { existsSync } from 'node:fs';
import path from 'node:path';

/** Sube desde `start` hasta encontrar `pnpm-workspace.yaml` (raíz del monorepo). */
export function findWorkspaceRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Directorio de los feeds `fixture:`: `FIXTURES_DIR` o `<raíz del repo>/fixtures`. */
export function resolveFixturesDir(configured?: string): string {
  if (configured) return path.resolve(configured);
  const root = findWorkspaceRoot();
  return root ? path.join(root, 'fixtures') : path.resolve('fixtures');
}
