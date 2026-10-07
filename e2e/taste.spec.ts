import { expect, test, type Page } from '@playwright/test';
import { fsGet, mintCustomToken, signInAsCustomer } from './helpers';

/**
 * The personal home: consent, the taste game, the band (popular / usual / feedback), wishes answered
 * with meals (the emulator's AI is the stub in functions/src/lib/claude.ts), the knows-me page, the
 * sign-in merge, and the live admin costs page. Seed: Abu Salim's two branches serve Beit Jann.
 */
const FS = `http://127.0.0.1:${8080 + (Number(process.env.EMU_PORT_OFFSET ?? 0) || 0)}/v1/projects/qareeb-dev/databases/(default)/documents`;
const FN = `http://127.0.0.1:${5001 + (Number(process.env.EMU_PORT_OFFSET ?? 0) || 0)}/qareeb-dev/me-west1`;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
function encode(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
}
async function fsSet(path: string, data: Record<string, Json>) {
  const res = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encode(data).mapValue!.fields }) });
  if (!res.ok) throw new Error(`fsSet ${path}: ${res.status}`);
}
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const shawarmaLine = (qty: number): Json => ({ lineId: `l${Math.random().toString(36).slice(2, 8)}`, productId: 'p-shawarma', name: { he: 'שווארמה' }, pricingMode: 'unit', unitLabel: {}, unitPriceAgorot: 4000, quantity: qty, lineTotalAgorot: 4000 * qty, trackInventory: false, modifiers: [{ groupId: 'g-bread', groupName: { he: 'לחם' }, optionId: 'o-laffa', optionName: { he: 'לאפה' }, priceDeltaAgorot: 500 }] });
async function seedOrder(uid: string, id: string, hoursAgo: number) {
  await fsSet(`orders/${id}`, { id, businessId: 'biz-abu-salim', branchId: 'br-abu-salim-main', businessName: { he: 'שווארמה אבו סלים' }, branchName: { he: 'סניף ראשי' }, customer: { uid }, status: 'accepted', stage: 'completed', mode: 'pickup', revision: 0, reference: 'E2E', placedAt: ago(hoursAgo), totals: { cashDueAgorot: 8000 }, originalTotals: { cashDueAgorot: 8000 }, branchPhone: '+972501234567', contactName: 'e2e', contactPhone: '+972500000000', lines: [shawarmaLine(2)] });
}
async function signInFresh(page: Page, uid: string) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __qareebSignIn?: unknown }).__qareebSignIn);
  await page.evaluate(async (tok) => { await (window as unknown as { __qareebSignIn: (t: string) => Promise<void> }).__qareebSignIn(tok); }, mintCustomToken(uid));
}

test.describe('first visit', () => {
  // Start before the consent sheet was ever seen on this device.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('consent, then the four-tap game; the quiz is kept on the device until sign-in, then linked', async ({ page }) => {
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: 'שקריב ילמד מה אתם אוהבים?' });
    await expect(sheet).toBeVisible();
    // The two answers are the same size; nothing is pre-ticked.
    const yes = sheet.getByRole('button', { name: 'כן, ללמוד' });
    const no = sheet.getByRole('button', { name: 'לא עכשיו' });
    const [a, b] = [await yes.boundingBox(), await no.boundingBox()];
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(2);
    await yes.click();

    const game = page.getByRole('dialog', { name: 'משחק טעמים' });
    await expect(game.getByText('שאלה 1 מתוך 4')).toBeVisible();
    await game.getByRole('button', { name: 'משפחה' }).click();
    await game.getByRole('button', { name: 'פיצה' }).click();
    await game.getByRole('button', { name: 'שניהם' }).click();
    await game.getByRole('button', { name: 'אף אחד' }).click();
    await expect(game).toBeHidden();
    await expect(page.getByText('תודה! ההצעות שלכם עודכנו.')).toBeVisible();
    // With a quiz, the band stops asking for one.
    await expect(page.getByRole('button', { name: 'ספרו לנו מה אתם אוהבים' })).toHaveCount(0);
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('qareeb.taste.v1') ?? '{}'));
    expect(local.doc.quiz.party).toBe('family');
    expect(local.doc.quiz.pairs).toHaveLength(3);

    // Sign in: keep the picks in the account.
    const uid = `e2e-taste-${Date.now()}`;
    await signInFresh(page, uid);
    const merge = page.getByRole('dialog', { name: 'לשמור את הבחירות שלכם?' });
    await expect(merge).toBeVisible();
    await merge.getByRole('button', { name: 'לשמור', exact: true }).click();
    await expect(merge).toBeHidden();
    await expect.poll(async () => ((await fsGet(`users/${uid}/taste/profile`))?.quiz as { party?: string } | null)?.party).toBe('family');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qareeb.taste.v1') ?? '{}').doc)).toBeNull();
  });

  test('"Not now" closes the sheet for good on this device', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: 'שקריב ילמד מה אתם אוהבים?' }).getByRole('button', { name: 'לא עכשיו' }).click();
    await page.reload();
    await expect(page.getByPlaceholder('מה בא לך?')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'שקריב ילמד מה אתם אוהבים?' })).toHaveCount(0);
  });
});

test('the cold band shows what is popular now, from both branches', async ({ page }) => {
  await page.goto('/');
  const band = page.locator('.tband');
  await expect(band.getByRole('heading', { name: /^פופולרי/ })).toBeVisible();
  await expect(band.locator('.tcard')).toHaveCount(2);
  await expect(band.locator('.tcard').filter({ hasText: 'סניף חורפיש' })).toHaveCount(1);
});

test('a wish gets two meals; the meal sheet puts the meal in the cart with the cheapest choices', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.removeItem('qareeb.cart.v1'); localStorage.removeItem('qareeb.taste.v1'); });
  await page.reload();
  await page.getByRole('searchbox', { name: 'חיפוש מנות' }).fill('שווארמה לשניים');
  await page.getByRole('button', { name: /לשאול את קריב/ }).click();
  // Signed out without AI consent: asked once; "Without AI" builds the meals in code.
  await page.getByRole('button', { name: 'בלי AI' }).click();
  const albums = page.locator('.talbum');
  await expect(albums).toHaveCount(2);
  await expect(albums.first()).toContainText('2 × שווארמה');
  await expect(page.getByText('הצעת AI')).toHaveCount(0);

  await albums.first().click();
  const sheet = page.getByRole('dialog');
  // Two shawarmas for two (the cheapest bread), plus one side the code builder adds within budget.
  await expect(sheet.getByRole('button', { name: /הוספה לסל/ })).toContainText('82');
  await sheet.getByRole('button', { name: /הוספה לסל/ }).click();
  await expect(sheet).toBeHidden();
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('qareeb.cart.v1') ?? '{}').cart);
  expect(cart.lines).toEqual([
    expect.objectContaining({ productId: 'p-shawarma', quantity: 2, modifiers: [{ groupId: 'g-bread', optionIds: ['o-pita'] }], expectedUnitPriceAgorot: 3500 }),
    expect.objectContaining({ productId: 'p-fries', quantity: 1, expectedUnitPriceAgorot: 1200 }),
  ]);
});

test('with AI consent the wish is answered by the AI (stub), labelled, and sent once', async ({ page }) => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const calls = async () => (((await fsGet(`spendDaily/${day}`))?.ai as { calls?: number } | undefined)?.calls ?? 0);
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'חיפוש מנות' }).fill('פלאפל לשלושה');
  await page.getByRole('searchbox', { name: 'חיפוש מנות' }).press('Enter');
  const before = await calls();
  await page.getByRole('button', { name: 'כן, לשלוח' }).click();
  await expect(page.getByText('הצעת AI')).toBeVisible();
  await expect(page.locator('.talbum').first()).toContainText('ארוחה טעימה');
  await page.waitForTimeout(1500);
  expect(await calls()).toBe(before + 1);
});

test('feedback: "not again" takes the dish out of suggestions; the knows-me page shows and undoes it', async ({ page }) => {
  const uid = `e2e-fb-${Date.now()}`;
  await signInFresh(page, uid);
  await seedOrder(uid, `${uid}-a`, 24 * 6);
  await seedOrder(uid, `${uid}-b`, 3);
  await page.reload();
  const card = page.locator('.tfb');
  await expect(card).toContainText('איך היה משווארמה אבו סלים?');
  await card.getByRole('button', { name: 'לא שוב' }).click();
  await expect(page.getByText('פחות כאלה בהצעות')).toBeVisible();
  await expect.poll(async () => ((await fsGet(`users/${uid}/dishFeedback/${uid}-b`))?.items as Record<string, string> | undefined)?.['p-shawarma']).toBe('not_again');
  // The card closes once every dish is answered; the main branch's shawarma leaves the band.
  await expect(card).toHaveCount(0);
  await expect(page.locator('.tusual')).toHaveCount(0);
  await expect(page.locator('.tband .tcard').filter({ hasText: 'סניף ראשי' })).toHaveCount(0);

  await page.goto('/account/taste');
  const item = page.locator('.tknows__item', { hasText: 'לא שוב: שווארמה' });
  await expect(item).toBeVisible();
  await item.getByRole('button').click();
  await expect(item).toHaveCount(0);
  await expect.poll(async () => (await fsGet(`users/${uid}/taste/profile`))?.suppressed).toEqual([`notAgain:br-abu-salim-main/p-shawarma`]);

  // Back home the usual returns: two orders of the main branch's shawarma.
  await page.goto('/');
  await expect(page.locator('.tusual')).toContainText('להזמין שוב');
  await page.getByRole('button', { name: 'להזמין שוב' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator('main')).toContainText('לאפה');
});

test('delete everything clears ratings and stops older orders from teaching', async ({ page }) => {
  const uid = `e2e-del-${Date.now()}`;
  await signInFresh(page, uid);
  await seedOrder(uid, `${uid}-a`, 24 * 6);
  await seedOrder(uid, `${uid}-b`, 24 * 4);
  await page.goto('/account/taste');
  await expect(page.locator('.tknows__item', { hasText: 'הרגיל: שווארמה' })).toBeVisible();
  await page.getByRole('button', { name: 'למחוק את כל מה שנלמד' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'מחיקה' }).click();
  await expect(page.locator('.tknows__item', { hasText: 'הרגיל: שווארמה' })).toHaveCount(0);
  expect((await fsGet(`users/${uid}/taste/profile`))?.ignoreOrdersBefore).toBeTruthy();
});

test('admin costs page updates live while a wish is answered elsewhere', async ({ page }) => {
  await signInAsCustomer(page, 'seed-admin');
  await page.goto('/admin/costs');
  await expect(page.getByRole('heading', { name: 'עלויות' })).toBeVisible();
  await expect(page.locator('.costs__head').getByText('חי', { exact: true })).toBeVisible();
  const count = page.locator('.costs__row--note').first();
  await expect(count).toContainText('בקשות');
  const before = Number((await count.innerText()).match(/\d+/)![0]);
  const res = await fetch(`${FN}/suggestMeals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { wish: 'שווארמה', locale: 'he', cityId: 'beit-jann', ai: true } }) });
  expect(res.ok).toBe(true);
  await expect(count).toContainText(`${before + 1} בקשות`);
});
