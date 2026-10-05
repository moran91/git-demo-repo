import { describe, expect, it } from 'vitest';
import { computePairs, type PairOrder } from '../../src/index.js';

const order = (...ids: string[]): PairOrder => ({ status: 'accepted', lines: ids.map((productId) => ({ productId })) });

describe('computePairs', () => {
  it('needs at least 10 orders', () => {
    expect(computePairs(Array.from({ length: 9 }, () => order('a', 'b')))).toBeNull();
  });
  it('counts products bought together, top first, ignoring rejected, removed, combos and single sightings', () => {
    const orders = [
      ...Array.from({ length: 6 }, () => order('pizza', 'cola')),
      ...Array.from({ length: 3 }, () => order('pizza', 'fries')),
      order('pizza', 'salad'),
      { status: 'rejected', lines: [{ productId: 'pizza' }, { productId: 'beer' }, { productId: 'beer2' }] },
      { status: 'accepted', lines: [{ productId: 'pizza' }, { productId: 'gone', removed: true }, { productId: 'c1', comboId: 'c1' }] },
    ];
    const pairs = computePairs(orders)!;
    expect(pairs.pizza).toEqual([{ productId: 'cola', count: 6 }, { productId: 'fries', count: 3 }]);
    expect(pairs.cola).toEqual([{ productId: 'pizza', count: 6 }]);
    expect(pairs.salad).toBeUndefined();
  });
});
