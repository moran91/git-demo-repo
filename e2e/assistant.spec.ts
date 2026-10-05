import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The assistant: the home (ask box, suggestions, greeting with picks, places open first) and the
 * /ask chat. Seed: Abu Salim has two branches serving Beit Jann (main, Hurfeish), each with shawarma
 * (bread to choose), falafel, fries, cola and knafeh; the main branch has the "family meal" combo.
 */
const FS = `http://127.0.0.1:${8080 + (Number(process.env.EMU_PORT_OFFSET ?? 0) || 0)}/v1/projects/qareeb-dev/databases/(default)/documents`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('cart')) localStorage.removeItem(k);
    sessionStorage.clear();
  });
  await page.reload();
});

/** The whole shekels in a price text ("החל מ־‏98 ‏₪" → 98, "‏69.90 ‏₪" → 69.9). */
async function shekels(el: Locator): Promise<number> {
  const text = (await el.textContent()) ?? '';
  const m = /\d+(?:\.\d+)?/.exec(text);
  if (!m) throw new Error(`no price in "${text}"`);
  return Number(m[0]);
}

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await input.fill(text);
  await input.press('Enter');
}

function cartBranch(page: Page) {
  return page.evaluate(() => (JSON.parse(localStorage.getItem('qareeb.cart.v1') ?? '{}') as { cart?: { branchId?: string } | null }).cart?.branchId ?? null);
}

test('home: ask box, suggestions, then the greeting and picks; the ask box opens the chat', async ({ page }) => {
  const assist = page.getByRole('region', { name: 'עוזר' });
  const askBox = assist.getByRole('button', { name: 'מה בא לכם?' });
  const chips = assist.getByRole('group', { name: 'הצעות' });
  await expect(askBox).toBeVisible();
  await expect(chips.getByRole('button').first()).toBeVisible();
  await expect(assist.locator('.assist__greeting')).toBeVisible();
  // Spec §2 order: ask box, chips, greeting, picks.
  const top = async (l: Locator) => (await l.boundingBox())!.y;
  expect(await top(askBox)).toBeLessThan(await top(chips));
  expect(await top(chips)).toBeLessThan(await top(assist.locator('.assist__greeting')));
  await expect(assist.locator('.ac').first()).toBeVisible();
  // Deals are always labelled.
  await expect(assist.locator('.ac--deal')).toContainText('מבצע');

  await askBox.click();
  await expect(page).toHaveURL(/\/ask$/);
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await expect(input).toBeFocused();
  await ask(page, 'שווארמה');
  await expect(page.locator('.ask__user')).toHaveText('שווארמה');
  await expect(page.locator('.ac--dish').first()).toContainText('שווארמה');
});

test('home chip opens the chat and answers it', async ({ page }) => {
  const chip = page.getByRole('group', { name: 'הצעות' }).getByRole('button', { name: 'מה במבצע?' });
  await chip.click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.locator('.ask__user')).toHaveText('מה במבצע?');
  await expect(page.locator('.ask__turn').last().locator('.ac--deal').first()).toContainText('ארוחה משפחתית');
});

test('a meal for 2: "add all" fills the cart with the card total', async ({ page }) => {
  await page.goto('/ask');
  await ask(page, 'ל-2');
  const meal = page.locator('.ac--meal').first();
  await expect(meal).toBeVisible();
  const total = await shekels(meal.locator('.ac__head .ac__price'));
  await meal.getByRole('button', { name: 'הוספת הכול' }).click();
  // Shawarma needs a bread: one sheet per unit opens after the other; the rest goes straight in.
  const shawarmas = () => page.evaluate(() => ((JSON.parse(localStorage.getItem('qareeb.cart.v1') ?? '{}') as { cart?: { lines: Array<{ productId: string; quantity: number }> } }).cart?.lines ?? []).filter((l) => l.productId === 'p-shawarma').reduce((n, l) => n + l.quantity, 0));
  for (let i = 1; i <= 2; i++) {
    const sheet = page.getByRole('dialog', { name: 'שווארמה' });
    await sheet.getByLabel('פיתה').check();
    await sheet.getByRole('button', { name: /הוספה לסל/ }).click();
    await expect.poll(shawarmas).toBe(i);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cartTotal = page.locator('.ask__cart-total');
  await expect(cartTotal).toBeVisible();
  await expect.poll(() => shekels(cartTotal)).toBe(total);
});

test('refinement "יותר זול" keeps the request and lowers the total', async ({ page }) => {
  await page.goto('/ask');
  await ask(page, 'ל-2');
  const first = await shekels(page.locator('.ask__turn').last().locator('.ac--meal .ac__head .ac__price').first());
  await page.getByRole('button', { name: 'יותר זול' }).click();
  await expect(page.locator('.ask__user').last()).toHaveText('יותר זול');
  const turn = page.locator('.ask__turn').last();
  await expect(turn.locator('.ask__line')).toContainText('2');
  await expect(turn.locator('.ac--meal').first()).toBeVisible();
  expect(await shekels(turn.locator('.ac--meal .ac__head .ac__price').first())).toBeLessThan(first);
});

test('replace cart once: a dish from the other branch asks one confirmation, then moves the cart', async ({ page }) => {
  await page.goto('/ask');
  await ask(page, 'קולה');
  // The answer's cards (an upsell turn follows the first add, so not "the last turn").
  const cards = page.locator('.ac--dish').filter({ hasText: 'קולה' });
  const main = cards.filter({ hasText: 'סניף ראשי' }).first();
  const hurfeish = cards.filter({ hasText: 'סניף חורפיש' }).first();
  await main.getByRole('button', { name: /הוספת קולה/ }).click();
  await expect(page.locator('.ask__cart')).toBeVisible();
  await expect.poll(() => cartBranch(page)).toBe('br-abu-salim-main');

  // Count every dialog that opens from here on.
  await page.evaluate(() => {
    const w = window as unknown as { __dialogs: number };
    w.__dialogs = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) if (n instanceof Element) w.__dialogs += (n.matches('dialog') ? 1 : 0) + n.querySelectorAll('dialog').length;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await hurfeish.getByRole('button', { name: /הוספת קולה/ }).click();
  await page.getByRole('button', { name: 'החלפת הסל' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => cartBranch(page)).toBe('br-abu-salim-hurfeish');
  await expect(page.locator('.ask__cart')).toBeVisible();
  // Give a late second confirm or sheet the chance to show, then check none did.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __dialogs: number }).__dialogs)).toBe(1);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('qareeb.cart.v1') ?? '{}') as { cart?: { lines: unknown[] } }).cart?.lines.length)).toBe(1);
});

test('places: open first, a paused place folds into the closed row', async ({ page }) => {
  const path = 'publicBranches/br-abu-salim-hurfeish';
  const pause = (paused: boolean) =>
    fetch(`${FS}/${path}?updateMask.fieldPaths=ordersPaused`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { ordersPaused: { booleanValue: paused } } }) });
  expect((await pause(true)).ok).toBe(true);
  try {
    const places = page.locator('.places');
    const closed = places.locator('details.places-closed');
    await expect(closed.locator('summary')).toHaveText('סגורים כעת (1)');
    await expect(places.locator(':scope > .place-list .place-row')).toHaveCount(1);
    await expect(places.locator(':scope > .place-list')).toContainText('סניף ראשי');
    await expect(closed).not.toHaveAttribute('open');
    await closed.locator('summary').click();
    await expect(closed.locator('.place-row')).toContainText('סניף חורפיש');
    // A paused place is never offered for adding on the home.
    await expect(page.getByRole('region', { name: 'עוזר' }).locator('.ac').filter({ hasText: 'סניף חורפיש' })).toHaveCount(0);
  } finally {
    await pause(false);
  }
});
