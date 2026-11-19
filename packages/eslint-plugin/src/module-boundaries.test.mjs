import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { moduleBoundaries } from './module-boundaries.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

// Raíz absoluta nativa (con unidad de disco en Windows): ESLint exige rutas absolutas.
const cwd = path.resolve('repo');
const mod = (p) => path.join(cwd, 'apps/backend/src/modules', p);
const src = (p) => path.join(cwd, 'apps/backend/src', p);

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

// RuleTester no expone cwd por caso; se fija modulesDir absoluto.
const options = [{ modulesDir: path.join(cwd, 'apps/backend/src/modules') }];

tester.run('module-boundaries', moduleBoundaries, {
  valid: [
    {
      name: 'import interno del mismo módulo',
      filename: mod('catalog/catalog.routes.ts'),
      code: "import { x } from './catalog.service';",
      options,
    },
    {
      name: 'subcarpeta del mismo módulo',
      filename: mod('catalog/sub/a.ts'),
      code: "import { x } from '../catalog.service';",
      options,
    },
    {
      name: 'índice de otro módulo (carpeta)',
      filename: mod('search/search.service.ts'),
      code: "import { x } from '../catalog';",
      options,
    },
    {
      name: 'índice de otro módulo (index)',
      filename: mod('search/search.service.ts'),
      code: "import { x } from '../catalog/index';",
      options,
    },
    {
      name: 'índice de otro módulo (index.js)',
      filename: mod('search/search.service.ts'),
      code: "import { x } from '../catalog/index.js';",
      options,
    },
    {
      name: 'app.ts usa el índice',
      filename: src('app.ts'),
      code: "import { x } from './modules/health/index';",
      options,
    },
    {
      name: 'shared desde un módulo',
      filename: mod('catalog/a.ts'),
      code: "import { x } from '../../shared/errors';",
      options,
    },
    {
      name: 'paquete externo',
      filename: mod('catalog/a.ts'),
      code: "import { z } from 'zod';",
      options,
    },
  ],
  invalid: [
    {
      name: 'interno de otro módulo (relativo corto)',
      filename: mod('search/search.service.ts'),
      code: "import { x } from '../catalog/catalog.service';",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      name: 'interno de otro módulo (por modules/)',
      filename: mod('search/search.service.ts'),
      code: "import { x } from '../../modules/catalog/catalog.service';",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      name: 'interno desde fuera de modules',
      filename: src('app.ts'),
      code: "import { x } from './modules/health/health.service';",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      name: 're-export de un interno',
      filename: mod('search/index.ts'),
      code: "export { x } from '../catalog/catalog.service';",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      name: 'import dinámico de un interno',
      filename: mod('search/a.ts'),
      code: "await import('../catalog/catalog.service');",
      options,
      errors: [{ messageId: 'internal' }],
    },
    {
      name: 'index de una subcarpeta interna',
      filename: mod('search/a.ts'),
      code: "import { x } from '../catalog/sub/index';",
      options,
      errors: [{ messageId: 'internal' }],
    },
  ],
});
