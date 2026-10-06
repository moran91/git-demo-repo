import { describe, expect, it } from 'vitest';
import { popularCountKey, rankPopular, sumCounts } from '../src/taste/index.js';

describe('popularity', () => {
  it('builds stable count keys', () => {
    expect(popularCountKey('evening', 'br-1', 'p_1')).toBe('evening|br-1|p_1');
  });

  it('sums daily docs, skipping missing days', () => {
    expect(sumCounts([{ 'evening|b|p': 2 }, undefined, { 'evening|b|p': 1, 'noon|b|q': 4 }])).toEqual({ 'evening|b|p': 3, 'noon|b|q': 4 });
  });

  it('keeps dishes with 3+ orders, ranks by count then id, top 12 per daypart, ranks only', () => {
    const counts: Record<string, number> = { 'evening|b|low': 2, 'evening|b|mid': 5, 'evening|a|tie': 7, 'evening|b|tie': 7, 'noon|c|x': 3, 'bogus|b|p': 9, 'late|onlybranch': 9 };
    for (let i = 0; i < 15; i++) counts[`morning|m|p${String(i).padStart(2, '0')}`] = 3 + i;
    const r = rankPopular(counts);
    expect(r.evening).toEqual([{ branchId: 'a', productId: 'tie' }, { branchId: 'b', productId: 'tie' }, { branchId: 'b', productId: 'mid' }]);
    expect(r.noon).toEqual([{ branchId: 'c', productId: 'x' }]);
    expect(r.late).toEqual([]);
    expect(r.morning).toHaveLength(12);
    expect(r.morning[0]).toEqual({ branchId: 'm', productId: 'p14' });
    // Privacy: every published entry is a bare ref, never a count.
    const shapes = Object.values(r).flat().map((ref) => Object.keys(ref).sort().join(','));
    expect(new Set(shapes)).toEqual(new Set(['branchId,productId']));
  });
});
