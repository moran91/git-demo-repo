import { describe, expect, it } from 'vitest';
import { detectDir } from '../src/receipt/render.js';

/**
 * Regression: U+00D7 (×) and U+00F7 (÷) sit inside the 0x00C0–0x024F Latin range but are maths
 * symbols (bidi class ON), not letters. Treating them as strong LTR made the quantity row of a
 * Hebrew ticket — `2 × שווארמה` — lay out left-to-right while every other line on the same receipt
 * laid out right-to-left.
 */
describe('receipt direction detection', () => {
  it('does not let × or ÷ decide the direction of an RTL line', () => {
    expect(detectDir('2 × שווארמה בלאפה', 'rtl')).toBe('rtl');
    expect(detectDir('3 ÷ פיתות', 'rtl')).toBe('rtl');
  });

  it('keeps the rest of a Hebrew ticket right-to-left', () => {
    expect(detectDir('  + צ׳יפס', 'rtl')).toBe('rtl');
    expect(detectDir('מבוקש 1.25 ק״ג עגבניות', 'rtl')).toBe('rtl');
  });

  it('still detects genuine Latin text as left-to-right', () => {
    expect(detectDir('2 x Shawarma', 'rtl')).toBe('ltr');
    expect(detectDir('Café au lait', 'rtl')).toBe('ltr');
  });

  it('falls back when a line carries no strong character at all', () => {
    expect(detectDir('2 × 3', 'rtl')).toBe('rtl');
    expect(detectDir('2 × 3', 'ltr')).toBe('ltr');
  });
});
