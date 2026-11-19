import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Resuelve un host a todas sus direcciones IP (inyectable en tests). */
export type HostLookup = (hostname: string) => Promise<string[]>;

export const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** Rangos no públicos: loopback, privados, enlace local (metadatos de la nube), CGNAT, multicast… */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** ¿Es una dirección pública? Las IPv4 mapeadas en IPv6 (::ffff:a.b.c.d) se evalúan como IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class FeedUrlError extends Error {
  constructor(reason: string) {
    // Sin la URL: puede llevar el token del programa de afiliados.
    super(`destino del feed no permitido: ${reason}`);
    this.name = 'FeedUrlError';
  }
}

/**
 * Comprueba un destino de feed antes de cada petición, también tras cada redirección: solo
 * https, sin credenciales en la URL y con todas sus IP públicas (evita SSRF hacia la red
 * interna o el servicio de metadatos de la nube).
 */
export async function assertSafeFeedUrl(raw: string, lookup: HostLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FeedUrlError('URL inválida');
  }
  if (url.protocol !== 'https:') throw new FeedUrlError('solo se admite https');
  if (url.username || url.password) throw new FeedUrlError('la URL no puede llevar credenciales');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => []);
  if (addresses.length === 0) throw new FeedUrlError('el host no resuelve');
  if (!addresses.every(isPublicAddress)) throw new FeedUrlError('dirección no pública');
  return url;
}
