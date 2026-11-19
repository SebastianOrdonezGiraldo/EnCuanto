import { describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  FeedHttpError,
  FeedSource,
  resolveFixturePath,
  TokenBucket,
  withRetry,
} from '../../src/modules/providers/index';
import { FIXTURES_DIR } from './helpers';

describe('TokenBucket (§9)', () => {
  it('permite una ráfaga y luego rps fichas por segundo', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 3, () => now);
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 500; // medio segundo a 2 rps = 1 ficha
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('take espera lo necesario', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket(
      1,
      1,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    await bucket.take();
    await bucket.take();
    expect(sleeps).toEqual([1000]);
  });
});

describe('withRetry (§9)', () => {
  it('reintenta 3 veces con espera exponencial con jitter y luego falla', async () => {
    const sleeps: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error('caído'));
    await expect(
      withRetry(fn, { baseMs: 100, random: () => 1, sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toThrow('caído');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('no reintenta lo que shouldRetry descarta', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('404'));
    await expect(withRetry(fn, { shouldRetry: () => false })).rejects.toThrow('404');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('el jitter queda en [0, tope]', () => {
    expect(backoffDelay(10, 500, 30_000, () => 0.5)).toBe(15_000);
    expect(backoffDelay(0, 500, 30_000, () => 0)).toBe(0);
  });
});

describe('FeedSource https', () => {
  const ok = () => new Response('[]', { status: 200 });

  it('reintenta 503 y luego responde', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok());
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, retryBaseMs: 1 });
    const stream = await source.open('https://feeds.example/f.json', new AbortController().signal);
    stream.destroy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un 404 y el error no lleva la URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, retryBaseMs: 1 });
    const error = await source
      .open('https://feeds.example/f.json?token=secreto', new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeedHttpError);
    expect(String((error as Error).message)).not.toContain('secreto');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveFixturePath', () => {
  it('no permite salir del directorio de fixtures', () => {
    expect(() => resolveFixturePath('fixture:../package.json', FIXTURES_DIR)).toThrow();
    expect(resolveFixturePath('fixture:ejemplos/x.json', FIXTURES_DIR)).toContain('ejemplos');
  });
});
