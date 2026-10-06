import { expect, test } from '@playwright/test';

/**
 * The food-first home (mockup 9): search and dish-type chips across every restaurant in the city.
 * Seed: Abu Salim has two branches serving Beit Jann, each with shawarma, falafel, fries, cola and
 * knafeh typed as shawarma / mains / snacks / drinks / desserts; the market is a supermarket.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('cart')) localStorage.removeItem(k); });
  await page.reload();
});

test('dish chips list matching dishes from every place, naming the branch when a business has two', async ({ page }) => {
  await expect(page.getByPlaceholder('מה בא לך?')).toBeVisible();
  const chips = page.getByRole('group', { name: 'סוגי מנות' });
  await expect(chips.getByRole('button', { name: 'שווארמה' })).toBeVisible();
  // Only types that have dishes get a chip.
  await expect(chips.getByRole('button', { name: 'סושי' })).toHaveCount(0);

  await chips.getByRole('button', { name: 'שווארמה' }).click();
  await expect(chips.getByRole('button', { name: 'שווארמה' })).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('.crave-dish');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'סניף חורפיש' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'סניף ראשי' })).toHaveCount(1);

  // Tapping the chosen chip again clears it and brings back the default view (best sellers).
  await chips.getByRole('button', { name: 'שווארמה' }).click();
  await expect(chips.getByRole('button', { name: 'שווארמה' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: 'רב מכר' })).toBeVisible();
});

test('search ranks the dish before other dishes of a place whose name matches, and adds in one tap', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'חיפוש מנות' });
  await search.fill('שווארמה');
  const names = page.locator('.crave-dish__name');
  await expect(names.first()).toHaveText('שווארמה');
  await expect(names.nth(1)).toHaveText('שווארמה');
  await expect(names.nth(2)).not.toHaveText('שווארמה');

  // Cola has nothing to choose: "+" puts it straight in the cart.
  await search.fill('קולה');
  await page.locator('.crave-dish').first().getByRole('button', { name: /הוספת קולה/ }).click();
  // No toast: the bottom-nav basket takes the add (fly-in, count) instead.
  await expect(page.getByText('הוספה לסל ✓')).toHaveCount(0);
  await expect(page.locator('.bottom-nav a.has-items .bottom-nav__count')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => JSON.stringify(localStorage))).toContain('p-cola');

  // Shawarma needs a bread choice, so "+" opens the product sheet instead.
  await search.fill('שווארמה');
  await page.locator('.crave-dish').first().getByRole('button', { name: /הוספת שווארמה/ }).click();
  await expect(page.getByRole('dialog', { name: 'שווארמה' })).toBeVisible();
});

test('an unmatched search says what to do next', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'חיפוש מנות' }).fill('בורגר');
  await expect(page.getByText('אין מנות שמתאימות ל„בורגר”')).toBeVisible();
});

test('the places switch changes the places list, not the dish search', async ({ page }) => {
  const places = page.locator('.place-list');
  await expect(places.locator('.place-row')).toHaveCount(2);
  await page.getByRole('radio', { name: 'סופרמרקטים' }).click();
  await expect(places.getByText('מרכול בית ג׳ן')).toBeVisible();
  await expect(page.getByRole('group', { name: 'סוגי מנות' }).getByRole('button', { name: 'שווארמה' })).toBeVisible();
  await page.getByRole('radio', { name: 'מסעדות' }).click();
});

test('search finds dishes while typing, marks the match, and reads a wrong keyboard', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'חיפוש מנות' });
  const first = page.locator('.crave-dish__name').first();
  await search.fill('שו');
  await expect(first).toHaveText('שווארמה');
  await expect(first.locator('mark')).toHaveText('שו');
  // "shaw" half-typed in Latin letters already finds it.
  await search.fill('shaw');
  await expect(first).toHaveText('שווארמה');
  // שווארמה typed with the keyboard left on English.
  await search.fill('auutrnv');
  await expect(page.getByText('תוצאות עבור „שווארמה”')).toBeVisible();
  await expect(first).toHaveText('שווארמה');
});

test('search crosses languages and spellings: Hebrew and Latin find an Arabic-only dish', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'חיפוש מנות' });
  for (const q of ['כנאפה', 'kunafa', 'knafeh']) {
    await search.fill(q);
    await expect(page.locator('.crave-dish__name').filter({ hasText: 'كنافة' }).first(), q).toBeVisible();
  }
});
