// Crea .env a partir de .env.example si no existe, para que `pnpm i && pnpm dev` funcione sin pasos manuales.
// En CI (variable CI definida) no hace nada: allí las variables vienen del workflow.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = join(root, '.env');
const example = join(root, '.env.example');

if (!process.env.CI && !existsSync(env) && existsSync(example)) {
  copyFileSync(example, env);
  console.log('.env creado a partir de .env.example');
}
