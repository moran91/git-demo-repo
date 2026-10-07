import { describe, expect, it } from 'vitest';
import type { DishType } from '../src/dishIndex.js';
import { deriveTaste, emptyTasteDoc, summaryLines, type TasteDoc, type TasteOrder } from '../src/taste/index.js';

const NOW = new Date('2026-10-06T18:00:00.000Z');
const doc: TasteDoc = {
  ...emptyTasteDoc(NOW.toISOString()),
  consent: { orders: true, learn: true, ai: true, version: 1, locale: 'he', at: NOW.toISOString() },
  quiz: { party: 'family', pairs: [{ a: 'burger', b: 'pizza', answer: 'a' }, { a: 'sushi', b: 'hummus', answer: 'neither' }], at: NOW.toISOString() },
};
// Three evening orders (17:30 UTC is 20:30 in Israel).
const orders: TasteOrder[] = [1, 2, 3].map((i) => ({ id: `o${i}`, branchId: 'branch-77', placedAt: new Date(NOW.getTime() - i * 86_400_000 - 30 * 60_000).toISOString(), status: 'accepted', lines: [{ productId: 'prod-555' }] }));
const typeOf = (_b: string, p: string): DishType | undefined => (p === 'prod-555' ? 'shawarma' : undefined);

describe('summaryLines', () => {
  it('describes the profile in short localised lines', () => {
    const d = deriveTaste({ doc, orders, feedback: [], now: NOW });
    expect(summaryLines(d, 'he', typeOf)).toEqual(['בדרך כלל למשפחה', 'אוהבים: בורגר, שווארמה', 'פחות: חומוס, סושי', 'מזמינים בדרך כלל בערב', 'מזמינים בקביעות']);
    expect(summaryLines(d, 'ar', typeOf)[1]).toBe('يحب: برغر، شاورما');
  });

  it('never carries a digit, an id, a name or a date, and stays within 6 lines', () => {
    const d = deriveTaste({ doc, orders, feedback: [], now: NOW });
    for (const locale of ['he', 'ar', 'en'] as const) {
      const lines = summaryLines(d, locale, typeOf);
      expect(lines.length).toBeLessThanOrEqual(6);
      const text = lines.join('\n');
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/branch|prod/);
    }
  });

  it('says a new customer has no orders yet', () => {
    const d = deriveTaste({ doc: null, orders: [], feedback: [], now: NOW });
    expect(summaryLines(d, 'en', typeOf)).toEqual(['No orders yet']);
  });
});
