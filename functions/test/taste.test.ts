import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asGuest, asUid, expectCode, type Client } from './harness.js';

type Taste = { consent: null | { orders: boolean; learn: boolean; ai: boolean; at: string }; quiz: null | { party?: string; pairs: unknown[]; at: string }; suppressed: string[]; ignoreOrdersBefore: string | null; lastAiSummary: unknown };
const consent = (over: Partial<{ orders: boolean; learn: boolean; ai: boolean }> = {}) => ({ orders: true, learn: true, ai: true, version: 1, locale: 'he', ...over });
const quiz = { party: 'family', pairs: [{ a: 'burger', b: 'pizza', answer: 'b' }] };
const tasteDoc = async (uid: string) => (await admin.db.doc(`users/${uid}/taste/profile`).get()).data() as Taste | undefined;

// Fresh uids per run: these tests must not depend on seed customers' state.
const UID_A = `taste-a-${Date.now()}`;
const UID_B = `taste-b-${Date.now()}`;
let a: Client;
let b: Client;
beforeAll(async () => { [a, b] = await Promise.all([asUid(UID_A), asUid(UID_B)]); });
afterAll(async () => { await Promise.all([a.close(), b.close()]); });

describe('saveTaste', () => {
  it('needs sign-in', async () => {
    const guest = await asGuest();
    expect(await expectCode(guest.call('saveTaste', { consent: consent() }))).toBe('unauthenticated');
    await guest.close();
  });

  it('stamps consent with server time and stores the quiz', async () => {
    const before = Date.now();
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { consent: consent(), quiz });
    expect(Date.parse(taste.consent!.at)).toBeGreaterThanOrEqual(before - 5000);
    expect(taste.quiz).toMatchObject({ party: 'family', pairs: quiz.pairs });
    expect(await tasteDoc(UID_A)).toMatchObject({ v: 1, quiz: { party: 'family' } });
  });

  it('refuses a quiz without learn consent', async () => {
    expect(await expectCode(b.call('saveTaste', { consent: consent({ learn: false }), quiz }))).toBe('invalid_argument');
    expect((await tasteDoc(UID_B))?.quiz ?? null).toBeNull();
  });

  it('withdrawing learn deletes the quiz; withdrawing ai deletes the last AI summary', async () => {
    await admin.db.doc(`users/${UID_A}/taste/profile`).set({ lastAiSummary: { text: 'משפחה', at: new Date().toISOString() } }, { merge: true });
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { consent: consent({ learn: false, ai: false }) });
    expect(taste.quiz).toBeNull();
    expect(taste.lastAiSummary).toBeNull();
    expect((await tasteDoc(UID_A))!.quiz).toBeNull();
  });

  it('clearQuiz removes the quiz and suppressed keys are de-duplicated', async () => {
    await a.call('saveTaste', { consent: consent(), quiz });
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { clearQuiz: true, suppressed: ['party', 'party', 'type:pizza'] });
    expect(taste.quiz).toBeNull();
    expect(taste.suppressed).toEqual(['party', 'type:pizza']);
  });

  it('rejects allergies and unknown keys', async () => {
    expect(await expectCode(a.call('saveTaste', { allergies: ['nuts'] }))).toBe('invalid_argument');
    expect(await expectCode(a.call('saveTaste', { suppressed: ['phone:0501234567'] }))).toBe('invalid_argument');
  });
});

describe('mergeTaste', () => {
  it('link copies local consent and quiz into an empty profile, and a retry changes nothing', async () => {
    const uid = `taste-merge-${Date.now()}`;
    const c = await asUid(uid);
    const local = { consent: consent({ ai: false }), quiz: { ...quiz, at: new Date(Date.now() - 3 * 86_400_000).toISOString() }, suppressed: ['type:burger'] };
    const first = (await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local })).taste;
    expect(first.consent).toMatchObject({ orders: true, learn: true, ai: false });
    expect(first.quiz!.at).toBe(local.quiz.at);
    expect(first.suppressed).toEqual(['type:burger']);
    const retry = (await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { ...local, consent: consent({ learn: false }) } })).taste;
    expect(retry.consent).toEqual(first.consent);
    expect(retry.quiz).toEqual(first.quiz);
    expect(retry.suppressed).toEqual(['type:burger']);
    await c.close();
  });

  it('link into an existing profile only adds suppressed keys', async () => {
    const { taste } = await a.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { consent: consent({ orders: false }), suppressed: ['daypart:late'] } });
    expect(taste.consent!.orders).toBe(true);
    expect(taste.suppressed).toContain('daypart:late');
  });

  it('a quiz time in the future becomes now', async () => {
    const uid = `taste-future-${Date.now()}`;
    const c = await asUid(uid);
    const { taste } = await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { consent: consent(), quiz: { ...quiz, at: '2099-01-01T00:00:00.000Z' } } });
    expect(Date.parse(taste.quiz!.at)).toBeLessThanOrEqual(Date.now() + 5000);
    await c.close();
  });

  it('fresh creates an empty profile and ignores the local one', async () => {
    const uid = `taste-fresh-${Date.now()}`;
    const c = await asUid(uid);
    const { taste } = await c.call<{ taste: Taste }>('mergeTaste', { choice: 'fresh', local: { consent: consent(), quiz } });
    expect(taste).toMatchObject({ consent: null, quiz: null, suppressed: [] });
    await c.close();
  });
});

describe('deleteTaste', () => {
  it('deletes feedback, clears the quiz and suppressed keys, keeps consent, and stops older orders teaching', async () => {
    await a.call('saveTaste', { consent: consent(), quiz, suppressed: ['party'] });
    await admin.db.doc(`users/${UID_A}/dishFeedback/fake-order`).set({ orderId: 'fake-order', items: { p: 'loved' } });
    const before = Date.now();
    const { taste } = await a.call<{ taste: Taste }>('deleteTaste', {});
    expect(taste.consent).toMatchObject({ learn: true });
    expect(taste.quiz).toBeNull();
    expect(taste.suppressed).toEqual([]);
    expect(Date.parse(taste.ignoreOrdersBefore!)).toBeGreaterThanOrEqual(before - 5000);
    expect((await admin.db.collection(`users/${UID_A}/dishFeedback`).get()).empty).toBe(true);
  });
});
