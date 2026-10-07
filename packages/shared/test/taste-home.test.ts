import { describe, expect, it } from 'vitest';
import type { DishIndexEntry, DishType } from '../src/dishIndex.js';
import { deriveTaste, emptyTasteDoc, pickHomeBand, scoreDish, type BandDish, type PopularDayparts, type TasteDoc, type TasteOrder } from '../src/taste/index.js';

// 18:00 UTC in October is 21:00 in Israel: evening.
const NOW = new Date('2026-10-06T18:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;
let n = 0;
const order = (branchId: string, productIds: string[], placedAt: string, extra: Partial<TasteOrder> = {}): TasteOrder => ({
  id: `o${++n}`, branchId, placedAt, status: 'accepted', lines: productIds.map((productId) => ({ productId })), ...extra,
});
const entry = (dishType: DishType, over: Partial<DishIndexEntry> = {}): DishIndexEntry => ({
  name: { he: dishType }, priceAgorot: 5000, fromPrice: false, dishType, available: true, needsChoice: false, sortOrder: 0, ...over,
});
const dish = (branchId: string, productId: string, type: DishType, over: Partial<BandDish> = {}, e: Partial<DishIndexEntry> = {}): BandDish => ({
  branchId, productId, entry: entry(type, e), open: true, ...over,
});
const doc = (over: Partial<TasteDoc> = {}): TasteDoc => ({
  ...emptyTasteDoc(NOW.toISOString()),
  consent: { orders: true, learn: true, ai: false, version: 1, locale: 'he', at: ago(10 * DAY) },
  ...over,
});
const pop = (evening: Array<[string, string]>): PopularDayparts => ({ morning: [], noon: [], late: [], evening: evening.map(([branchId, productId]) => ({ branchId, productId })) });

function band(opts: { orders?: TasteOrder[]; dishes: BandDish[]; popular?: PopularDayparts | null; tasteDoc?: TasteDoc | null; rated?: string[] }) {
  const orders = opts.orders ?? [];
  const derived = deriveTaste({ doc: opts.tasteDoc === undefined ? doc() : opts.tasteDoc, orders, feedback: [], now: NOW });
  return pickHomeBand({ derived, orders, ratedOrderIds: opts.rated ?? [], ordersConsent: (opts.tasteDoc === undefined ? doc() : opts.tasteDoc)?.consent?.orders ?? true, dishes: opts.dishes, popular: opts.popular ?? null, now: NOW });
}

describe('usual', () => {
  it('picks the newest learned order holding a usual dish when every line can be ordered', () => {
    const older = order('b1', ['pz', 'cola'], ago(9 * DAY));
    const newer = order('b1', ['pz'], ago(3 * DAY));
    const b = band({ orders: [older, newer], dishes: [dish('b1', 'pz', 'pizza'), dish('b1', 'cola', 'drinks')] });
    expect(b.usual?.order.id).toBe(newer.id);
    expect(b.usual?.productId).toBe('pz');
  });

  it('skips an order whose place is closed or whose dish is gone', () => {
    const o1 = order('b1', ['pz'], ago(9 * DAY));
    const o2 = order('b1', ['pz'], ago(3 * DAY));
    expect(band({ orders: [o1, o2], dishes: [dish('b1', 'pz', 'pizza', { open: false })] }).usual).toBeNull();
    expect(band({ orders: [o1, o2], dishes: [dish('b1', 'pz', 'pizza', {}, { available: false })] }).usual).toBeNull();
    expect(band({ orders: [o1, o2], dishes: [] }).usual).toBeNull();
  });

  it('falls back to an older order when the newest has a line that cannot be ordered', () => {
    const o1 = order('b1', ['pz'], ago(9 * DAY));
    const o2 = order('b1', ['pz', 'gone'], ago(3 * DAY));
    expect(band({ orders: [o1, o2], dishes: [dish('b1', 'pz', 'pizza')] }).usual?.order.id).toBe(o1.id);
  });

  it('never offers an order with a combo line, and ignores removed lines', () => {
    const o1 = order('b1', [], ago(9 * DAY), { lines: [{ productId: 'pz' }, { productId: 'x', removed: true }] });
    const o2 = order('b1', [], ago(3 * DAY), { lines: [{ productId: 'pz' }, { productId: 'c1', comboId: 'combo' }] });
    expect(band({ orders: [o1, o2], dishes: [dish('b1', 'pz', 'pizza')] }).usual?.order.id).toBe(o1.id);
  });
});

describe('try and popular', () => {
  it('try is a popular dish never ordered, not disliked; popular is the top 2 open', () => {
    const o1 = order('b1', ['pz'], ago(9 * DAY));
    const o2 = order('b1', ['pz'], ago(3 * DAY));
    const dishes = [dish('b1', 'pz', 'pizza'), dish('b2', 'sushi1', 'sushi'), dish('b3', 'burg', 'burger'), dish('b4', 'closed', 'pasta', { open: false })];
    const tasteDoc = doc({ quiz: { party: null, pairs: [{ a: 'sushi', b: 'hummus', answer: 'neither' }], at: ago(DAY) } });
    const b = band({ orders: [o1, o2], dishes, tasteDoc, popular: pop([['b4', 'closed'], ['b1', 'pz'], ['b2', 'sushi1'], ['b3', 'burg']]) });
    expect(b.tryPick?.productId).toBe('burg');
    expect(b.popular.map((d) => d.productId)).toEqual(['pz', 'sushi1']);
  });

  it('falls back to the owners\' most-ordered dishes when nothing is popular yet', () => {
    const dishes = [dish('b1', 'a', 'pizza', {}, { mostOrdered: true }), dish('b2', 'b', 'burger', {}, { mostOrdered: true }), dish('b3', 'c', 'pasta')];
    const b = band({ dishes, popular: null, tasteDoc: null });
    expect(b.popular.map((d) => d.productId).sort()).toEqual(['a', 'b']);
    expect(b.tryPick && ['a', 'b'].includes(b.tryPick.productId)).toBe(true);
  });

  it('never shows a "not again" dish', () => {
    const o = order('b1', ['pz'], ago(3 * DAY));
    const derived = deriveTaste({ doc: doc(), orders: [o], feedback: [{ orderId: o.id, branchId: 'b1', placedAt: o.placedAt, items: { pz: 'not_again' }, forSomeoneElse: false, dismissed: false, updatedAt: o.placedAt }], now: NOW });
    const b = pickHomeBand({ derived, orders: [o], ratedOrderIds: [o.id], ordersConsent: true, dishes: [dish('b1', 'pz', 'pizza'), dish('b2', 'x', 'pasta')], popular: pop([['b1', 'pz'], ['b2', 'x']]), now: NOW });
    expect(b.popular.map((d) => d.productId)).toEqual(['x']);
  });
});

describe('feedback order', () => {
  it('asks about the newest accepted order placed 90 minutes to 7 days ago, once', () => {
    const tooNew = order('b1', ['pz'], ago(30 * MIN));
    const ok = order('b1', ['pz'], ago(2 * 60 * MIN));
    const old = order('b1', ['pz'], ago(8 * DAY));
    const dishes = [dish('b1', 'pz', 'pizza')];
    expect(band({ orders: [tooNew, ok, old], dishes }).feedbackOrder?.id).toBe(ok.id);
    expect(band({ orders: [tooNew, ok, old], dishes, rated: [ok.id] }).feedbackOrder).toBeNull();
    expect(band({ orders: [ok], dishes, tasteDoc: doc({ consent: { orders: false, learn: false, ai: false, version: 1, locale: 'he', at: ago(DAY) } }) }).feedbackOrder).toBeNull();
    expect(band({ orders: [order('b1', ['pz'], ago(2 * 60 * MIN), { status: 'rejected' })], dishes }).feedbackOrder).toBeNull();
  });

  it('skips an order with nothing to rate', () => {
    const combo = order('b1', [], ago(2 * 60 * MIN), { lines: [{ productId: 'c', comboId: 'k' }] });
    expect(band({ orders: [combo], dishes: [] }).feedbackOrder).toBeNull();
  });
});

describe('scoreDish', () => {
  it('ranks usual and loved dishes over strangers, and rules out closed and "not again" dishes', () => {
    const o1 = order('b1', ['pz'], ago(9 * DAY));
    const o2 = order('b1', ['pz'], ago(3 * DAY));
    const derived = deriveTaste({ doc: doc(), orders: [o1, o2], feedback: [{ orderId: o2.id, branchId: 'b1', placedAt: o2.placedAt, items: { bad: 'not_again' }, forSomeoneElse: false, dismissed: false, updatedAt: o2.placedAt }], now: NOW });
    const ctx = { derived, popular: null, daypart: 'evening' as const };
    expect(scoreDish(dish('b1', 'pz', 'pizza'), ctx)).toBeGreaterThan(scoreDish(dish('b2', 'other', 'pizza'), ctx));
    expect(scoreDish(dish('b1', 'bad', 'pizza'), ctx)).toBe(-Infinity);
    expect(scoreDish(dish('b2', 'x', 'pizza', { open: false }), ctx)).toBe(-Infinity);
  });

  it('adds popularity by rank and quiz affinity by type', () => {
    const derived = deriveTaste({ doc: doc({ quiz: { party: null, pairs: [{ a: 'burger', b: 'pizza', answer: 'a' }], at: ago(DAY) } }), orders: [], feedback: [], now: NOW });
    const popular = pop([['b1', 'first'], ['b1', 'second']]);
    const ctx = { derived, popular, daypart: 'evening' as const };
    expect(scoreDish(dish('b1', 'first', 'pasta'), ctx)).toBeGreaterThan(scoreDish(dish('b1', 'second', 'pasta'), ctx));
    expect(scoreDish(dish('b2', 'y', 'burger'), ctx)).toBeGreaterThan(scoreDish(dish('b2', 'z', 'pizza'), ctx));
  });
});
