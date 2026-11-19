import path from 'node:path';

/**
 * Regla de módulos (§5): un módulo solo expone su index.ts.
 *
 * Resuelve cada import relativo a una ruta absoluta y, si el destino está dentro de
 * `<modulesDir>/<modulo>/`, solo lo permite cuando:
 *   - el archivo que importa pertenece al mismo módulo (imports internos), o
 *   - el destino es el índice del módulo (`<modulo>`, `<modulo>/index`, `<modulo>/index.ts|.js`).
 *
 * Opciones: { modulesDir: string } relativo al cwd de ESLint (por defecto apps/backend/src/modules).
 */
const INDEX_RE = /^index(\.(ts|js|mts|mjs))?$/;

/** Devuelve { module, rest } si `file` está dentro de modulesDir, o null. */
function locate(file, modulesDir) {
  const rel = path.relative(modulesDir, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [module, ...rest] = rel.split(path.sep);
  return { module, rest };
}

/** @type {import('eslint').Rule.RuleModule} */
export const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Solo se importa el index.ts de otro módulo (§5).' },
    schema: [
      {
        type: 'object',
        properties: { modulesDir: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      internal:
        'No importes archivos internos del módulo "{{module}}"; usa su index.ts (regla de módulos §5).',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const modulesDir = path.resolve(context.cwd, options.modulesDir ?? 'apps/backend/src/modules');
    const filename = context.filename;
    const from = locate(filename, modulesDir);

    function check(node) {
      const source = node.source?.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = locate(path.resolve(path.dirname(filename), source), modulesDir);
      if (!target) return;
      if (from && from.module === target.module) return;
      const isIndex =
        target.rest.length === 0 || (target.rest.length === 1 && INDEX_RE.test(target.rest[0]));
      if (!isIndex) {
        context.report({
          node: node.source,
          messageId: 'internal',
          data: { module: target.module },
        });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: (node) => check({ source: node.source }),
    };
  },
};
