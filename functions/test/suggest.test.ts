import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { israelDay, type SpendDay } from '@qareeb/shared';
import { admin, asEmail, asGuest, asUid, expectCode, IDS, USERS, type Client } from './harness.js';

/**
 * Wishes answered with meals. The emulator's AI is the stub in lib/claude.ts: it picks the first
 * dish of the first two places, and markers in the wish make it slow, wrong or broken.
 */
type Res = { meals: Array<{ branchId: string; items: Array<{ productId: string; qty: number }>; title?: string; reason: string; source: 'ai' | 'rules' }>; noFit: string; source: 'ai' | 'rules'; party: number };
const today = () => israelDay(new Date());
const spend = async () => ((await admin.db.doc(`spendDaily/${today()}`).get()).data() ?? {}) as Partial<SpendDay>;
const wish = (text: string, extra: Record<string, unknown> = {}) => ({ wish: text, locale: 'he', cityId: 'beit-jann', ...extra });
const DISHES = new Set(['p-shawarma', 'p-falafel', 'p-fries', 'p-knafeh', 'p-cola']);

let guest: Client;
beforeAll(async () => { guest = await asGuest(); });
afterAll(async () => { await guest.close(); });

describe('suggestMeals without the AI', () => {
  it('answers a signed-out wish from code with two meals of real, open dishes', async () => {
    const before = (await spend()).ai?.skipped ?? 0;
    const r = await guest.call<Res>('suggestMeals', wish('שווארמה לשניים', { ai: false }));
    expect(r.source).toBe('rules');
    expect(r.party).toBe(2);
    expect(r.meals).toHaveLength(2);
    expect(new Set(r.meals.map((m) => m.branchId))).toEqual(new Set([IDS.branchA, IDS.branchB]));
    for (const m of r.meals) {
      expect(m.items[0]).toEqual({ productId: 'p-shawarma', qty: 2 });
      expect(m.items.every((i) => DISHES.has(i.productId) && i.productId !== 'p-cola')).toBe(true);
      expect(m).not.toHaveProperty('priceAgorot');
    }
    expect((await spend()).ai?.skipped).toBe(before + 1);
  });

  it('names the problem when nothing fits the budget, and still offers the cheapest meals', async () => {
    const r = await guest.call<Res>('suggestMeals', wish('שווארמה עד 20', { ai: false }));
    expect(r.noFit).toBe('budget');
    expect(r.meals.length).toBeGreaterThan(0);
  });

  it('rejects junk input', async () => {
    expect(await expectCode(guest.call('suggestMeals', wish('')))).toBe('invalid_argument');
    expect(await expectCode(guest.call('suggestMeals', { ...wish('פיצה'), uid: 'x' }))).toBe('invalid_argument');
  });
});

describe('suggestMeals with the AI (stub)', () => {
  it('answers with the AI and writes the cost to the ledger, never the wish text', async () => {
    const before = await spend();
    const r = await guest.call<Res>('suggestMeals', wish('שווארמה', { ai: true }));
    expect(r.source).toBe('ai');
    expect(r.meals[0]!.source).toBe('ai');
    expect(r.meals[0]!.title).toBe('ארוחה טעימה');
    const after = await spend();
    expect(after.ai!.ok).toBe((before.ai?.ok ?? 0) + 1);
    expect(after.ai!.microUsd).toBeGreaterThan(before.ai?.microUsd ?? 0);
    expect(after.ai!.inTok).toBeGreaterThan(before.ai?.inTok ?? 0);
    expect(after.ai!.byModel.stub!.calls).toBe((before.ai?.byModel?.stub?.calls ?? 0) + 1);
    expect(Object.values(after.byHour ?? {}).some((h) => (h.aiIn ?? 0) > 0)).toBe(true);
    expect(JSON.stringify(after)).not.toContain('שווארמה');
  });

  it.each([
    ['[stub:malformed]', 'invalid'],
    ['[stub:wrong]', 'invalid'],
    ['[stub:error]', 'error'],
  ] as const)('falls back to code meals when the AI answer is %s', async (marker, reason) => {
    const before = (await spend()).ai?.fallback?.[reason] ?? 0;
    const r = await guest.call<Res>('suggestMeals', wish(`שווארמה ${marker}`, { ai: true }));
    expect(r.source).toBe('rules');
    expect(r.meals.length).toBeGreaterThan(0);
    expect((await spend()).ai!.fallback[reason]).toBe(before + 1);
  });

  it('gives up on a slow AI after 4.5 s and answers from code', async () => {
    const before = (await spend()).ai?.fallback?.timeout ?? 0;
    const started = Date.now();
    const r = await guest.call<Res>('suggestMeals', wish('שווארמה [stub:slow]', { ai: true }));
    expect(Date.now() - started).toBeLessThan(7500);
    expect(r.source).toBe('rules');
    expect((await spend()).ai!.fallback.timeout).toBe(before + 1);
  }, 20_000);

  it('skips the AI once today\'s spend reaches the cap', async () => {
    await admin.db.doc('config/platform').set({ aiDailyCapMicroUsd: 1 }, { merge: true });
    try {
      const before = (await spend()).ai?.fallback?.capped ?? 0;
      const r = await guest.call<Res>('suggestMeals', wish('שווארמה', { ai: true }));
      expect(r.source).toBe('rules');
      expect((await spend()).ai!.fallback.capped).toBe(before + 1);
    } finally {
      await admin.db.doc('config/platform').update({ aiDailyCapMicroUsd: FieldValue.delete() });
    }
  });
});

describe('suggestMeals for a signed-in customer', () => {
  it('uses the stored consent: with AI consent the summary sent is kept for the knows-me page', async () => {
    const uid = `suggest-${Date.now()}`;
    const c = await asUid(uid);
    try {
      await c.call('saveTaste', { consent: { orders: true, learn: true, ai: true, version: 1, locale: 'he' }, quiz: { party: 'family', pairs: [{ a: 'shawarma', b: 'pizza', answer: 'a' }] } });
      // The client's own claim is ignored when signed in.
      const r = await c.call<Res>('suggestMeals', wish('משהו טעים', { ai: false }));
      expect(r.source).toBe('ai');
      expect(r.party).toBe(4);
      const taste = (await admin.db.doc(`users/${uid}/taste/profile`).get()).data()!;
      expect(taste.lastAiSummary.text).toContain('בדרך כלל למשפחה');
      expect(taste.lastAiSummary.text).not.toMatch(/\d/);
    } finally {
      await c.close();
    }
  });

  it('without AI consent nothing goes to the AI and nothing is kept', async () => {
    const uid = `suggest-noai-${Date.now()}`;
    const c = await asUid(uid);
    try {
      await c.call('saveTaste', { consent: { orders: true, learn: false, ai: false, version: 1, locale: 'he' } });
      const r = await c.call<Res>('suggestMeals', wish('שווארמה', { ai: true }));
      expect(r.source).toBe('rules');
      expect((await admin.db.doc(`users/${uid}/taste/profile`).get()).data()!.lastAiSummary).toBeNull();
    } finally {
      await c.close();
    }
  });
});

describe('setAiDailyCap', () => {
  let adminC: Client;
  let owner: Client;
  beforeAll(async () => { [adminC, owner] = await Promise.all([asEmail(USERS.admin), asEmail(USERS.owner1)]); });
  afterAll(async () => {
    await admin.db.doc('config/platform').update({ aiDailyCapMicroUsd: FieldValue.delete() });
    await Promise.all([adminC.close(), owner.close()]);
  });

  it('admins set the cap in dollars, with an audit entry; others cannot; the range is 0–50', async () => {
    await adminC.call('setAiDailyCap', { usd: 3.5 });
    expect((await admin.db.doc('config/platform').get()).data()!.aiDailyCapMicroUsd).toBe(3_500_000);
    const audit = await admin.db.collection('audit').where('action', '==', 'config.aiDailyCap').get();
    expect(audit.docs.some((d) => d.data().after?.aiDailyCapMicroUsd === 3_500_000)).toBe(true);
    expect(await expectCode(owner.call('setAiDailyCap', { usd: 1 }))).toBe('forbidden');
    expect(await expectCode(adminC.call('setAiDailyCap', { usd: 51 }))).toBe('invalid_argument');
    expect(await expectCode(adminC.call('setAiDailyCap', { usd: -1 }))).toBe('invalid_argument');
  });

  it('saving other platform settings keeps the cap', async () => {
    await adminC.call('setAiDailyCap', { usd: 2.25 });
    await adminC.call('setPlatformConfig', { defaultCityId: 'beit-jann' });
    expect((await admin.db.doc('config/platform').get()).data()!.aiDailyCapMicroUsd).toBe(2_250_000);
  });
});
