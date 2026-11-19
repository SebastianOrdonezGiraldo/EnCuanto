import { defineConfig } from 'tsup';

// Empaqueta el backend en dist/ con los paquetes del monorepo incluidos,
// para que `node dist/server.js` funcione en cualquier plataforma (contenedor, PaaS o VPS).
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@encuanto\//],
});
