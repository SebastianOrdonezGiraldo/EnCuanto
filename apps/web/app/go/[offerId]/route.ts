import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};

/**
 * /go/:offerId en el dominio de la web (CU‑4): pide a la API el destino (que registra el clic)
 * y responde 302 a la tienda. Solo se sigue un destino http(s); si la oferta no existe o ya no
 * está vigente, se muestra una página propia.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  const unavailable = () =>
    NextResponse.redirect(new URL('/oferta-no-disponible', request.url), {
      status: 303,
      headers: HEADERS,
    });
  if (!UUID.test(offerId)) return unavailable();
  try {
    const res = await fetch(`${apiBaseUrl()}/go/${offerId}`, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const location = res.headers.get('location');
    if (res.status !== 302 || !location) return unavailable();
    const target = new URL(location);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return unavailable();
    return NextResponse.redirect(target, { status: 302, headers: HEADERS });
  } catch {
    return unavailable();
  }
}
