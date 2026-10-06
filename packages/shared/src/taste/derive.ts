import { DISH_TYPES, type DishType } from '../dishIndex.js';
import type { OrderStatus } from '../types.js';
import { daypartOf } from './daypart.js';
import { dishKey, splitDishKey, type Daypart, type DerivedTaste, type DishFeedback, type DishVerdict, type KnowsItem, type TasteDoc } from './types.js';

/** The parts of an order the profile learns from; a full Order satisfies it. */
export interface TasteOrder {
  id: string;
  branchId: string;
  placedAt: string;
  status: OrderStatus;
  lines: Array<{ productId: string; comboId?: string; removed?: boolean }>;
}

const DAY = 86_400_000;
export const USUAL_HALF_LIFE_DAYS = 60;
export const QUIZ_MAX_AGE_DAYS = 90;

/** How much the quiz still counts: real orders take over as they arrive, and the quiz expires. */
export function quizWeight(learnedOrders: number, quizAt: string | undefined, now: Date): number {
  if (!quizAt) return 0;
  if (now.getTime() - Date.parse(quizAt) > QUIZ_MAX_AGE_DAYS * DAY) return 0;
  if (learnedOrders <= 2) return 1;
  if (learnedOrders <= 9) return 0.5;
  return 0;
}

/** Dishes a line set teaches: once per order, never combos or lines removed by a revision. */
function taughtProducts(lines: TasteOrder['lines']): string[] {
  return [...new Set(lines.filter((l) => !l.comboId && !l.removed).map((l) => l.productId))];
}

/**
 * Everything Qareeb believes about one customer, from the stored doc, their orders and their dish
 * feedback. Pure, so the browser (home band, knows-me page) and the server (wishes) always agree.
 */
export function deriveTaste(input: { doc: TasteDoc | null; orders: TasteOrder[]; feedback: DishFeedback[]; now: Date }): DerivedTaste {
  const { doc, now } = input;
  const suppressed = new Set(doc?.suppressed ?? []);
  // Tier 1 is on by default, so a profile that was never asked still learns from orders.
  const useOrders = doc?.consent?.orders ?? true;
  const quiz = doc?.consent?.learn === true ? doc.quiz : null;
  const cutoff = doc?.ignoreOrdersBefore ? Date.parse(doc.ignoreOrdersBefore) : -Infinity;
  const someoneElse = new Set(input.feedback.filter((f) => f.forSomeoneElse).map((f) => f.orderId));

  const orders = useOrders
    ? input.orders.filter((o) => o.status === 'accepted' && Date.parse(o.placedAt) >= cutoff && !someoneElse.has(o.id))
    : [];

  // Ratings: the newest verdict per dish wins.
  const verdicts = new Map<string, DishVerdict>();
  if (useOrders) {
    const rated = input.feedback.filter((f) => !f.forSomeoneElse && Date.parse(f.placedAt) >= cutoff).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const f of rated) for (const [productId, verdict] of Object.entries(f.items)) verdicts.set(dishKey(f.branchId, productId), verdict);
  }
  const loved: string[] = [];
  const notAgain: string[] = [];
  for (const [key, verdict] of verdicts) {
    if (verdict === 'loved' && !suppressed.has(`loved:${key}`)) loved.push(key);
    if (verdict === 'not_again' && !suppressed.has(`notAgain:${key}`)) notAgain.push(key);
  }
  const notAgainSet = new Set(notAgain);

  // Usual: recency-weighted order frequency.
  const stats = new Map<string, { orders: number; score: number }>();
  for (const o of orders) {
    const ageDays = Math.max(0, now.getTime() - Date.parse(o.placedAt)) / DAY;
    const weight = Math.pow(0.5, ageDays / USUAL_HALF_LIFE_DAYS);
    for (const productId of taughtProducts(o.lines)) {
      const key = dishKey(o.branchId, productId);
      const s = stats.get(key) ?? { orders: 0, score: 0 };
      s.orders += 1;
      s.score += weight;
      stats.set(key, s);
    }
  }
  const usual = [...stats.entries()]
    .filter(([key, s]) => s.orders >= 2 && !notAgainSet.has(key) && !suppressed.has(`usual:${key}`))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, s]) => {
      const [branchId, productId] = splitDishKey(key);
      return { branchId, productId, score: s.score };
    });

  // Usual time of day.
  let daypart: Daypart | null = null;
  if (orders.length >= 3) {
    const counts = new Map<Daypart, number>();
    for (const o of orders) {
      const d = daypartOf(new Date(o.placedAt));
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    for (const [d, count] of counts) if (count / orders.length >= 0.6 && !suppressed.has(`daypart:${d}`)) daypart = d;
  }

  // Quiz.
  const told: Partial<Record<DishType, number>> = {};
  const add = (t: DishType, v: number) => { told[t] = (told[t] ?? 0) + v; };
  for (const p of quiz?.pairs ?? []) {
    if (p.answer === 'a') add(p.a, 1);
    else if (p.answer === 'b') add(p.b, 1);
    else if (p.answer === 'both') { add(p.a, 0.5); add(p.b, 0.5); }
    else { add(p.a, -0.5); add(p.b, -0.5); }
  }
  const weight = quizWeight(orders.length, quiz?.at, now);
  const affinity: Partial<Record<DishType, number>> = {};
  for (const t of DISH_TYPES) {
    const raw = told[t];
    if (raw === undefined || raw === 0 || weight === 0 || suppressed.has(`type:${t}`)) continue;
    affinity[t] = raw * weight;
  }
  const party = quiz?.party && !suppressed.has('party') ? quiz.party : null;

  const items: KnowsItem[] = [];
  if (party) items.push({ key: 'party', source: 'told', party });
  // Told types keep their order of appearance in the quiz.
  for (const p of quiz?.pairs ?? []) {
    for (const t of [p.a, p.b]) {
      if ((told[t] ?? 0) > 0 && !suppressed.has(`type:${t}`) && !items.some((i) => i.key === `type:${t}`)) items.push({ key: `type:${t}`, source: 'told', dishType: t });
    }
  }
  for (const u of usual) items.push({ key: `usual:${dishKey(u.branchId, u.productId)}`, source: 'orders', branchId: u.branchId, productId: u.productId });
  if (daypart) items.push({ key: `daypart:${daypart}`, source: 'orders', daypart });
  for (const key of loved) { const [branchId, productId] = splitDishKey(key); items.push({ key: `loved:${key}`, source: 'rated', branchId, productId }); }
  for (const key of notAgain) { const [branchId, productId] = splitDishKey(key); items.push({ key: `notAgain:${key}`, source: 'rated', branchId, productId }); }

  return { items, affinity, usual, orderedBefore: [...stats.keys()], loved, notAgain, daypart, party, learnedOrders: orders.length };
}
