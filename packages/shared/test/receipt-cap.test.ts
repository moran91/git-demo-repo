import { describe, expect, it } from 'vitest';
import { buildOrderReceipt } from '../src/receipt/model.js';
import { deliveryOrder } from './fixtures.js';
import type { Order, OrderLine } from '../src/types.js';

/**
 * Regression: the receipt has a block budget, and it used to be enforced with `blocks.slice(0, MAX)`.
 * Because the totals, the "cash on delivery" instruction and the footer are appended last, a large
 * order printed its items and then silently stopped — a cash ticket with no amount to collect.
 * The budget must come out of the item rows instead.
 */
const line = (i: number, mods: number): OrderLine => ({
  lineId: `l${i}`, productId: `p${i}`, name: { he: `פריט ${i}` }, pricingMode: 'unit', unitLabel: {},
  unitPriceAgorot: 1000, quantity: 1, lineTotalAgorot: 1000, trackInventory: false,
  modifiers: Array.from({ length: mods }, (_, k) => ({ groupId: `g${k}`, groupName: { he: 'קבוצה' }, optionId: `o${k}`, optionName: { he: `תוספת ${k}` }, priceDeltaAgorot: 100 })),
});
const build = (lines: number, mods: number) =>
  buildOrderReceipt({ ...deliveryOrder, lines: Array.from({ length: lines }, (_, i) => line(i, mods)) } as Order, {
    template: 'order_ticket', locale: 'he', paperWidthMm: 80, printableDots: 576,
  });
const text = (r: ReturnType<typeof build>) => JSON.stringify(r.blocks);

describe('receipt block budget', () => {
  it('keeps the total, the cash instruction and the footer on an oversized order', () => {
    const r = build(120, 3); // comfortably over the budget
    expect(r.blocks.length).toBeLessThanOrEqual(400);
    expect(text(r)).toContain('סה״כ');          // total row
    expect(text(r)).toContain('מזומן במשלוח');  // cash on delivery
    expect(text(r)).toContain('לא חשבונית מס'); // footer
  });

  it('says how many item rows were left out instead of dropping them silently', () => {
    const r = build(120, 3);
    expect(text(r)).toContain('שלא נדפסו');
  });

  it('leaves ordinary orders untouched', () => {
    const r = build(6, 2);
    expect(r.blocks.length).toBeLessThan(400);
    expect(text(r)).not.toContain('שלא נדפסו');
    expect(text(r)).toContain('סה״כ');
  });
});
