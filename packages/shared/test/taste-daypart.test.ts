import { describe, expect, it } from 'vitest';
import { daypartOf, dishKey, emptyTasteDoc, splitDishKey } from '../src/taste/index.js';

describe('daypartOf (Asia/Jerusalem)', () => {
  // January is UTC+2, July is UTC+3.
  it.each([
    ['2026-01-15T03:59:00.000Z', 'late'],     // 05:59
    ['2026-01-15T04:00:00.000Z', 'morning'],  // 06:00
    ['2026-01-15T08:59:00.000Z', 'morning'],  // 10:59
    ['2026-01-15T09:00:00.000Z', 'noon'],     // 11:00
    ['2026-01-15T14:00:00.000Z', 'evening'],  // 16:00
    ['2026-01-15T19:59:00.000Z', 'evening'],  // 21:59
    ['2026-01-15T20:00:00.000Z', 'late'],     // 22:00
    ['2026-01-15T22:30:00.000Z', 'late'],     // 00:30 the next local day
    ['2026-07-01T13:00:00.000Z', 'evening'],  // 16:00 in summer time
  ])('%s is %s', (iso, expected) => {
    expect(daypartOf(new Date(iso))).toBe(expected);
  });
});

describe('dish keys', () => {
  it('round-trips branch and product ids', () => {
    expect(dishKey('br-1', 'p_2')).toBe('br-1/p_2');
    expect(splitDishKey('br-1/p_2')).toEqual(['br-1', 'p_2']);
  });
});

describe('emptyTasteDoc', () => {
  it('starts with nothing learned', () => {
    expect(emptyTasteDoc('2026-10-06T10:00:00.000Z')).toEqual({ v: 1, consent: null, quiz: null, suppressed: [], ignoreOrdersBefore: null, lastAiSummary: null, updatedAt: '2026-10-06T10:00:00.000Z' });
  });
});
