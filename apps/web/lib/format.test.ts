import { describe, expect, it } from 'vitest';
import { formatCOP, variantLabel } from './format';

describe('formatCOP', () => {
  it('usa punto de miles y sin decimales', () => {
    expect(formatCOP(1899900)).toBe('$ 1.899.900');
    expect(formatCOP(900)).toBe('$ 900');
    expect(formatCOP(0)).toBe('$ 0');
  });

  it('rechaza valores no enteros', () => {
    expect(() => formatCOP(10.5)).toThrow(RangeError);
  });
});

describe('variantLabel', () => {
  it('compone los atributos en un orden fijo', () => {
    expect(variantLabel({ color: 'negro', ram_gb: 8, storage_gb: 256 })).toBe(
      '256 GB · 8 GB RAM · Negro',
    );
    expect(variantLabel({ storage_gb: 1024, ram_gb: 16, screen_in: 15.6 })).toBe(
      '1 TB · 16 GB RAM · 15,6"',
    );
    expect(variantLabel({ capacity_l: 1.5, color: 'rojo' })).toBe('1,5 L · Rojo');
    expect(variantLabel({ weight_kg: 17 })).toBe('17 kg');
  });

  it('sin atributos es la versión única', () => {
    expect(variantLabel({})).toBe('Única');
  });
});
