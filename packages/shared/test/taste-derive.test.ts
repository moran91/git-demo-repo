import { describe, expect, it } from 'vitest';
import { deriveTaste, emptyTasteDoc, quizWeight, type DishFeedback, type TasteDoc, type TasteOrder } from '../src/taste/index.js';

const NOW = new Date('2026-10-06T18:00:00.000Z');
const daysAgo = (d: number, hourUtc = 17) => { const t = new Date(NOW.getTime() - d * 86_400_000); t.setUTCHours(hourUtc, 0, 0, 0); return t.toISOString(); };
let n = 0;
const order = (branchId: string, productIds: string[], placedAt: string, extra: Partial<TasteOrder> = {}): TasteOrder => ({
  id: `o${++n}`, branchId, placedAt, status: 'accepted', lines: productIds.map((productId) => ({ productId })), ...extra,
});
const doc = (over: Partial<TasteDoc> = {}): TasteDoc => ({
  ...emptyTasteDoc(NOW.toISOString()),
  consent: { orders: true, learn: true, ai: false, version: 1, locale: 'he', at: daysAgo(10) },
  ...over,
});
const fb = (o: TasteOrder, items: DishFeedback['items'], over: Partial<DishFeedback> = {}): DishFeedback => ({
  orderId: o.id, branchId: o.branchId, placedAt: o.placedAt, items, forSomeoneElse: false, dismissed: false, updatedAt: o.placedAt, ...over,
});

describe('usual dishes', () => {
  it('needs 2 orders, ranks recent ones higher, keeps the top 3', () => {
    const orders = [
      order('b1', ['pizza'], daysAgo(200)), order('b1', ['pizza'], daysAgo(190)), order('b1', ['pizza'], daysAgo(180)),
      order('b1', ['fries'], daysAgo(3)), order('b1', ['fries'], daysAgo(2)),
      order('b2', ['salad'], daysAgo(5)), order('b2', ['salad'], daysAgo(4)),
      order('b2', ['soup'], daysAgo(6)), order('b2', ['soup'], daysAgo(7)),
      order('b3', ['once'], daysAgo(1)),
    ];
    const d = deriveTaste({ doc: doc(), orders, feedback: [], now: NOW });
    expect(d.usual.map((u) => u.productId)).toEqual(['fries', 'salad', 'soup']);
    expect(d.orderedBefore).toContain('b3/once');
    expect(d.items.filter((i) => i.source === 'orders' && i.key.startsWith('usual:')).map((i) => i.key)).toEqual(['usual:b1/fries', 'usual:b2/salad', 'usual:b2/soup']);
  });

  it('counts a dish once per order and ignores combo and removed lines', () => {
    const orders = [
      order('b1', [], daysAgo(2), { lines: [{ productId: 'p' }, { productId: 'p' }, { productId: 'c', comboId: 'combo1' }, { productId: 'r', removed: true }] }),
      order('b1', [], daysAgo(1), { lines: [{ productId: 'c', comboId: 'combo1' }, { productId: 'r', removed: true }] }),
    ];
    const d = deriveTaste({ doc: doc(), orders, feedback: [], now: NOW });
    expect(d.usual).toEqual([]);
    expect(d.orderedBefore).toEqual(['b1/p']);
  });

  it('ignores rejected and placed orders', () => {
    const orders = [order('b1', ['p'], daysAgo(2), { status: 'rejected' }), order('b1', ['p'], daysAgo(1), { status: 'placed' })];
    expect(deriveTaste({ doc: doc(), orders, feedback: [], now: NOW }).learnedOrders).toBe(0);
  });
});

describe('what stops learning', () => {
  const orders = () => [order('b1', ['p'], daysAgo(3)), order('b1', ['p'], daysAgo(2)), order('b1', ['p'], daysAgo(1))];

  it('orders consent off: nothing from orders or ratings', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ consent: { orders: false, learn: true, ai: false, version: 1, locale: 'he', at: daysAgo(1) } }), orders: os, feedback: [fb(os[0]!, { p: 'loved' })], now: NOW });
    expect(d.learnedOrders).toBe(0);
    expect(d.usual).toEqual([]);
    expect(d.loved).toEqual([]);
  });

  it('never-asked consent still learns from orders (tier 1 is on by default)', () => {
    expect(deriveTaste({ doc: null, orders: orders(), feedback: [], now: NOW }).usual).toHaveLength(1);
    expect(deriveTaste({ doc: emptyTasteDoc(NOW.toISOString()), orders: orders(), feedback: [], now: NOW }).usual).toHaveLength(1);
  });

  it('ignoreOrdersBefore drops older orders and their ratings', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ ignoreOrdersBefore: daysAgo(1, 0) }), orders: os, feedback: [fb(os[0]!, { p: 'not_again' })], now: NOW });
    expect(d.learnedOrders).toBe(1);
    expect(d.notAgain).toEqual([]);
  });

  it('forSomeoneElse feedback removes that order', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc(), orders: os, feedback: [fb(os[0]!, {}, { forSomeoneElse: true })], now: NOW });
    expect(d.learnedOrders).toBe(2);
  });

  it('suppressed keys hide items and their effect', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ suppressed: ['usual:b1/p', 'daypart:evening'] }), orders: os, feedback: [], now: NOW });
    expect(d.usual).toEqual([]);
    expect(d.daypart).toBeNull();
    expect(d.items).toEqual([]);
  });
});

describe('ratings', () => {
  it('the newest verdict per dish wins, and not-again dishes are never usual', () => {
    const a = order('b1', ['p', 'q'], daysAgo(3));
    const b = order('b1', ['p', 'q'], daysAgo(1));
    const d = deriveTaste({ doc: doc(), orders: [a, b], feedback: [fb(a, { p: 'loved', q: 'loved' }), fb(b, { q: 'not_again' })], now: NOW });
    expect(d.loved).toEqual(['b1/p']);
    expect(d.notAgain).toEqual(['b1/q']);
    expect(d.usual.map((u) => u.productId)).toEqual(['p']);
    expect(d.items.map((i) => i.key)).toEqual(expect.arrayContaining(['loved:b1/p', 'notAgain:b1/q']));
  });
});

describe('usual daypart', () => {
  it('needs 3 orders and a 60% share', () => {
    // 17:00 UTC in October is 20:00 in Israel: evening.
    const two = [order('b', ['x'], daysAgo(2)), order('b', ['y'], daysAgo(1))];
    expect(deriveTaste({ doc: doc(), orders: two, feedback: [], now: NOW }).daypart).toBeNull();
    const mixed = [order('b', ['x'], daysAgo(3)), order('b', ['x'], daysAgo(2, 9)), order('b', ['x'], daysAgo(1, 6))];
    expect(deriveTaste({ doc: doc(), orders: mixed, feedback: [], now: NOW }).daypart).toBeNull();
    const evenings = [...two, order('b', ['z'], daysAgo(3)), order('b', ['z'], daysAgo(4, 9))];
    const d = deriveTaste({ doc: doc(), orders: evenings, feedback: [], now: NOW });
    expect(d.daypart).toBe('evening');
    expect(d.items).toContainEqual({ key: 'daypart:evening', source: 'orders', daypart: 'evening' });
  });
});

describe('quiz', () => {
  const quiz = { party: 'family' as const, pairs: [{ a: 'burger' as const, b: 'pizza' as const, answer: 'b' as const }, { a: 'pasta' as const, b: 'mains' as const, answer: 'both' as const }, { a: 'sushi' as const, b: 'hummus' as const, answer: 'neither' as const }], at: daysAgo(5) };

  it('scores picks, both and neither, and lists told items', () => {
    const d = deriveTaste({ doc: doc({ quiz }), orders: [], feedback: [], now: NOW });
    expect(d.affinity).toEqual({ pizza: 1, pasta: 0.5, mains: 0.5, sushi: -0.5, hummus: -0.5 });
    expect(d.party).toBe('family');
    expect(d.items.filter((i) => i.source === 'told').map((i) => i.key)).toEqual(['party', 'type:pizza', 'type:pasta', 'type:mains']);
  });

  it('is ignored when learn consent is off', () => {
    const d = deriveTaste({ doc: doc({ quiz, consent: { orders: true, learn: false, ai: false, version: 1, locale: 'he', at: daysAgo(1) } }), orders: [], feedback: [], now: NOW });
    expect(d.affinity).toEqual({});
    expect(d.party).toBeNull();
    expect(d.items).toEqual([]);
  });

  it('a suppressed type keeps its item hidden and its weight at 0', () => {
    const d = deriveTaste({ doc: doc({ quiz, suppressed: ['type:pizza', 'party'] }), orders: [], feedback: [], now: NOW });
    expect(d.affinity.pizza).toBeUndefined();
    expect(d.party).toBeNull();
    expect(d.items.map((i) => i.key)).toEqual(['type:pasta', 'type:mains']);
  });

  it('fades with orders and age', () => {
    expect(quizWeight(0, daysAgo(1), NOW)).toBe(1);
    expect(quizWeight(2, daysAgo(1), NOW)).toBe(1);
    expect(quizWeight(3, daysAgo(1), NOW)).toBe(0.5);
    expect(quizWeight(9, daysAgo(1), NOW)).toBe(0.5);
    expect(quizWeight(10, daysAgo(1), NOW)).toBe(0);
    expect(quizWeight(0, daysAgo(91), NOW)).toBe(0);
    expect(quizWeight(0, undefined, NOW)).toBe(0);
  });
});
