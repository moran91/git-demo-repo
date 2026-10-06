import { describe, expect, it } from 'vitest';
import { knowsKeySchema, mergeTasteSchema, saveDishFeedbackSchema, saveTasteSchema } from '../src/schemas.js';

const consent = { orders: true, learn: true, ai: false, version: 1, locale: 'ar' as const };

describe('saveTasteSchema', () => {
  it('accepts consent, a quiz and suppressed keys', () => {
    const r = saveTasteSchema.safeParse({ consent, quiz: { party: 'family', pairs: [{ a: 'burger', b: 'pizza', answer: 'b' }] }, suppressed: ['party', 'type:pizza', 'usual:br-1/p-2', 'daypart:evening'] });
    expect(r.success).toBe(true);
  });
  it('rejects a pair of the same type, more than 3 pairs, unknown types and extra fields', () => {
    expect(saveTasteSchema.safeParse({ quiz: { party: 'solo', pairs: [{ a: 'pizza', b: 'pizza', answer: 'a' }] } }).success).toBe(false);
    const pair = { a: 'burger', b: 'pizza', answer: 'a' };
    expect(saveTasteSchema.safeParse({ quiz: { party: 'solo', pairs: [pair, pair, pair, pair] } }).success).toBe(false);
    expect(saveTasteSchema.safeParse({ quiz: { party: 'solo', pairs: [{ a: 'kebab', b: 'pizza', answer: 'a' }] } }).success).toBe(false);
    expect(saveTasteSchema.safeParse({ consent: { ...consent, allergies: ['nuts'] } }).success).toBe(false);
  });
  it('accepts a missing party (stripNulls drops null before parsing)', () => {
    expect(saveTasteSchema.safeParse({ quiz: { pairs: [] } }).success).toBe(true);
  });
  it('caps suppressed at 100', () => {
    expect(saveTasteSchema.safeParse({ suppressed: Array.from({ length: 101 }, () => 'party') }).success).toBe(false);
  });
});

describe('knowsKeySchema', () => {
  it.each(['party', 'type:sushi', 'usual:b/p', 'loved:b-1/p_1', 'notAgain:b/p', 'daypart:late'])('accepts %s', (k) => {
    expect(knowsKeySchema.safeParse(k).success).toBe(true);
  });
  it.each(['', 'usual:b', 'daypart:night', 'loved:b/p/x', 'phone:0501234567', 'type:Pizza'])('rejects %s', (k) => {
    expect(knowsKeySchema.safeParse(k).success).toBe(false);
  });
});

describe('mergeTasteSchema', () => {
  it('accepts an empty local profile and a full one', () => {
    expect(mergeTasteSchema.safeParse({ choice: 'fresh', local: {} }).success).toBe(true);
    expect(mergeTasteSchema.safeParse({ choice: 'link', local: { consent, quiz: { party: 'two', pairs: [], at: '2026-10-01T10:00:00.000Z' }, suppressed: ['party'] } }).success).toBe(true);
  });
  it('rejects an unknown choice', () => {
    expect(mergeTasteSchema.safeParse({ choice: 'both', local: {} }).success).toBe(false);
  });
});

describe('saveDishFeedbackSchema', () => {
  it('accepts verdicts including none, and the two flags', () => {
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: { p1: 'loved', p2: 'not_again', p3: 'none' }, forSomeoneElse: false, dismissed: true }).success).toBe(true);
  });
  it('rejects other verdicts, bad ids and more than 50 dishes', () => {
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: { p1: 'meh' } }).success).toBe(false);
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o/1', items: {} }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, 'loved']));
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: many }).success).toBe(false);
  });
});
