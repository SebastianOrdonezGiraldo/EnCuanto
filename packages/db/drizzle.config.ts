import { defineConfig } from 'drizzle-kit';

// Solo se usa para generar migraciones (`pnpm db:generate`), que no necesita conexión.
// Las migraciones se aplican con src/migrate-cli.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
});
