import { describe, expect, it } from 'vitest';
import { evaluateOpen, toLocal, EMPTY_WEEK } from '../src/hours.js';
import { normalizeIsraeliPhone, formatPhoneDisplay } from '../src/phone.js';
import { resolveLocalized } from '../src/localize.js';

describe('opening hours in Asia/Jerusalem', () => {
  const hours = { ...EMPTY_WEEK, '0': [{ startMin: 540, endMin: 1320 }], '4': [{ startMin: 1080, endMin: 1560 }] }; // Sun 09:00-22:00, Thu 18:00-02:00
  it('handles DST: 2026-07-05 (Sunday, UTC+3) 07:30Z = 10:30 local → open', () => {
    expect(evaluateOpen(new Date('2026-07-05T07:30:00Z'), hours).open).toBe(true);
    expect(toLocal(new Date('2026-07-05T07:30:00Z')).minutes).toBe(630);
  });
  it('handles winter time: 2026-12-06 (Sunday, UTC+2) 07:30Z = 09:30 local → open; 06:30Z closed', () => {
    expect(evaluateOpen(new Date('2026-12-06T07:30:00Z'), hours).open).toBe(true);
    expect(evaluateOpen(new Date('2026-12-06T06:30:00Z'), hours)).toMatchObject({ open: false, opensInMin: 30 });
  });
  it('supports overnight spill: Friday 01:00 local is open because Thursday runs until 02:00', () => {
    // 2026-07-10 is a Friday; 01:00 local = 2026-07-09T22:00Z
    expect(evaluateOpen(new Date('2026-07-09T22:00:00Z'), hours)).toMatchObject({ open: true, closesInMin: 60 });
    expect(evaluateOpen(new Date('2026-07-10T00:00:00Z'), hours).open).toBe(false);
  });
  it('date override replaces the weekly schedule', () => {
    expect(evaluateOpen(new Date('2026-07-05T07:30:00Z'), hours, [{ date: '2026-07-05', intervals: [] }]).open).toBe(false);
  });
});

describe('phone normalisation', () => {
  it('normalises Israeli formats to E.164', () => {
    expect(normalizeIsraeliPhone('050-123-4567')).toBe('+972501234567');
    expect(normalizeIsraeliPhone('+972 50 123 4567')).toBe('+972501234567');
    expect(normalizeIsraeliPhone('972501234567')).toBe('+972501234567');
    expect(normalizeIsraeliPhone('٠٥٠١٢٣٤٥٦٧')).toBe('+972501234567');
    expect(normalizeIsraeliPhone('04-990-1234')).toBe('+97249901234');
    expect(normalizeIsraeliPhone('12345')).toBeNull();
    expect(normalizeIsraeliPhone('+15551234567')).toBeNull();
  });
  it('formats for display', () => {
    expect(formatPhoneDisplay('+972501234567')).toBe('050-123-4567');
  });
});

describe('localisation resolver', () => {
  it('uses requested, then business default, then any', () => {
    expect(resolveLocalized({ he: 'א', en: 'A' }, 'ar', 'he')).toBe('א');
    expect(resolveLocalized({ en: 'A' }, 'ar', 'he')).toBe('A');
    expect(resolveLocalized({ ar: 'ب', en: 'A' }, 'ar', 'he')).toBe('ب');
    expect(resolveLocalized({}, 'he')).toBe('');
  });
});
