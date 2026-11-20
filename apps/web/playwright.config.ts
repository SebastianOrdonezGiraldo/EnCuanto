import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * e2e de búsqueda (H2). Necesita PostgreSQL y Redis con el seed sintético (`pnpm db:seed`) y el
 * build hecho (`pnpm build`). En local, si `pnpm dev` ya está corriendo, se reutiliza.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    locale: 'es-CO',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @encuanto/backend start',
      cwd: root,
      url: 'http://localhost:4000/health',
      reuseExistingServer: !CI,
      timeout: 60_000,
      env: { LOG_LEVEL: 'warn' },
    },
    {
      command: 'pnpm --filter @encuanto/web start',
      cwd: root,
      url: 'http://localhost:3000',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
