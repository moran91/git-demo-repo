import { describe, expect, it } from 'vitest';
import { israelDay, israelHour, projectEndOfDay, projectMonth, type SpendDay } from '../src/taste/index.js';

const day = (byHour: SpendDay['byHour'], aiMicro = 0, translateMicro = 0): SpendDay => ({
  ai: { microUsd: aiMicro, calls: 0, ok: 0, skipped: 0, fallback: { timeout: 0, invalid: 0, error: 0, capped: 0 }, inTok: 0, outTok: 0, inMicroUsd: 0, outMicroUsd: 0, fast: 0, byModel: {} },
  translate: { microUsd: translateMicro, chars: 0, jobs: 0 },
  byHour,
  updatedAt: '',
});

describe('Israeli day and hour', () => {
  it('uses Jerusalem time', () => {
    const t = new Date('2026-10-06T22:30:00.000Z'); // 01:30 on the 7th in Israel
    expect(israelDay(t)).toBe('2026-10-07');
    expect(israelHour(t)).toBe('01');
  });
});

describe('projectEndOfDay', () => {
  it('adds the average of each remaining hour to what was spent so far', () => {
    const today = day({ '09': { aiIn: 100 } }, 100);
    const prev = [day({ '20': { aiIn: 300, aiOut: 100 }, '08': { aiIn: 999 } }), day({ '20': { translate: 200 }, '23': { aiOut: 50 } })];
    // 100 so far + hour 20: (400 + 200) / 2 + hour 23: 50 / 2. Hour 08 has passed.
    expect(projectEndOfDay(today, prev, 9)).toBe(100 + 300 + 25);
  });

  it('is just today when there is no history', () => {
    expect(projectEndOfDay(day({}, 70, 30), [], 12)).toBe(100);
    expect(projectEndOfDay(null, [], 12)).toBe(0);
  });
});

describe('projectMonth', () => {
  it('projects the rest of the month from the last 7 days', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const days = [
      { id: '2026-09-30', total: 1000 },
      ...[3, 4, 5, 6, 7, 8, 9].map((d) => ({ id: `2026-10-0${d}`, total: 100 })),
      { id: '2026-10-10', total: 40 },
    ];
    const r = projectMonth(days, now);
    expect(r.monthToDate).toBe(740);
    // 21 days left in October after the 10th, at 100 a day.
    expect(r.projection).toBe(740 + 2100);
  });
});
