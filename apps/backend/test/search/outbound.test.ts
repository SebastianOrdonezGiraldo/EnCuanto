import { describe, expect, it } from 'vitest';
import { buildOutboundUrl } from '../../src/modules/outbound/index';

describe('buildOutboundUrl', () => {
  it('sin plantilla redirige a la URL de la oferta', () => {
    expect(buildOutboundUrl('https://tienda.example/p/1', null)).toBe('https://tienda.example/p/1');
  });

  it('aplica la plantilla de afiliado con la URL codificada', () => {
    expect(
      buildOutboundUrl('https://tienda.example/p/1?a=b', 'https://afiliado.example/r?id=7&u={url}'),
    ).toBe('https://afiliado.example/r?id=7&u=https%3A%2F%2Ftienda.example%2Fp%2F1%3Fa%3Db');
  });

  it.each([
    ['javascript:alert(1)', null],
    ['data:text/html,hola', null],
    ['https://usuario:clave@tienda.example/', null],
    ['no es una url', null],
    ['https://tienda.example/p/1', 'javascript:{url}'],
  ])('rechaza destinos que no son http(s): %s', (url, template) => {
    expect(buildOutboundUrl(url, template)).toBeNull();
  });
});
