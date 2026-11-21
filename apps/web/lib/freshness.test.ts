import { describe, expect, it } from 'vitest';
import { verifiedAgo } from './freshness';

const now = new Date('2026-11-19T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe('verifiedAgo', () => {
  it.each([
    [5, 'hace menos de una hora'],
    [60, 'hace 1 hora'],
    [150, 'hace 2 horas'],
    [24 * 60, 'hace 1 día'],
    [50 * 60, 'hace 2 días'],
  ])('%d min → %s', (minutes, text) => {
    expect(verifiedAgo(ago(minutes), now)).toBe(text);
  });
});
