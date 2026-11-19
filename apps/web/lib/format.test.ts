import { describe, expect, it } from 'vitest';
import { formatCOP } from './format';

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
