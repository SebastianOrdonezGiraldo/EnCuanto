import { describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  FeedHttpError,
  FeedSource,
  FeedUrlError,
  isPublicAddress,
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
  const publicLookup = async () => ['93.184.215.14'];

  it('reintenta 503 y luego responde', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok());
    const source = new FeedSource({
      fixturesDir: FIXTURES_DIR,
      fetch: fetchMock,
      lookup: publicLookup,
      retryBaseMs: 1,
    });
    const stream = await source.open('https://feeds.example/f.json', new AbortController().signal);
    stream.destroy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un 404 y el error no lleva la URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    const source = new FeedSource({
      fixturesDir: FIXTURES_DIR,
      fetch: fetchMock,
      lookup: publicLookup,
      retryBaseMs: 1,
    });
    const error = await source
      .open('https://feeds.example/f.json?token=secreto', new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeedHttpError);
    expect(String((error as Error).message)).not.toContain('secreto');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('FeedSource: redirecciones y SSRF', () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
  const lookup = async (host: string) =>
    host === 'interno.example' ? ['10.0.0.5'] : ['93.184.215.14'];
  const signal = new AbortController().signal;

  it('sigue una redirección a otro host https público', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect('https://cdn.example/feed.xml'))
      .mockResolvedValueOnce(new Response('<rss/>', { status: 200 }));
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, lookup });
    (await source.open('https://feeds.example/f.xml', signal)).destroy();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://feeds.example/f.xml',
      'https://cdn.example/feed.xml',
    ]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it.each([
    ['http://feeds.example/f.xml', 'solo se admite https'],
    ['https://169.254.169.254/latest/meta-data', 'dirección no pública'],
    ['https://[::1]/f.xml', 'dirección no pública'],
    ['https://interno.example/f.xml', 'dirección no pública'],
    ['https://usuario:clave@feeds.example/f.xml', 'credenciales'],
  ])('rechaza la redirección a %s sin reintentar', async (target, reason) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(redirect(target));
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, lookup });
    const error = await source.open('https://feeds.example/f.xml', signal).catch((e) => e);
    expect(error).toBeInstanceOf(FeedUrlError);
    expect((error as Error).message).toContain(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('corta tras 5 redirecciones', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => redirect('https://feeds.example/otra'));
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, lookup });
    await expect(source.open('https://feeds.example/f.xml', signal)).rejects.toThrow(
      'demasiadas redirecciones',
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('valida también la URL inicial', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const source = new FeedSource({ fixturesDir: FIXTURES_DIR, fetch: fetchMock, lookup });
    await expect(source.open('https://interno.example/f.xml', signal)).rejects.toThrow(
      FeedUrlError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['93.184.215.14', true],
    ['2606:4700::1111', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['::ffff:127.0.0.1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['no-es-ip', false],
  ])('isPublicAddress(%s) = %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('resolveFixturePath', () => {
  it('no permite salir del directorio de fixtures', () => {
    expect(() => resolveFixturePath('fixture:../package.json', FIXTURES_DIR)).toThrow();
    expect(resolveFixturePath('fixture:ejemplos/x.json', FIXTURES_DIR)).toContain('ejemplos');
  });
});
