import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

try {
  await runMigrations(url);
  console.warn('Migraciones aplicadas');
} catch (error) {
  console.error('Error al aplicar migraciones', error);
  process.exit(1);
}
