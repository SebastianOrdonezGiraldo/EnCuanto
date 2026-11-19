import { fileURLToPath } from 'node:url';

/** Directorio `fixtures/` del repo, como ruta nativa (también en Windows). */
export const FIXTURES_DIR = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
