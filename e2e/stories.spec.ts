import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLocale, signInEmail } from './helpers';

/**
 * Stories: an owner posts a photo from the business panel ("Stories"); customers see the store as an
 * Instagram-style circle at the top of the home page and play it full screen. Needs the emulators,
 * the seed (SEED_ALWAYS_OPEN=1) and the dev server, like the other specs.
 */
const BIZ = 'biz-abu-salim';
const BRANCH = 'br-abu-salim-main';
const FS = 'http://127.0.0.1:8080/v1/projects/qareeb-dev/databases/(default)/documents';
/** Seeded products have no photos; give one a photo through the emulators (private doc + projection). */
async function givePhoto(productId: string, file: string) {
  const path = `businesses/${BIZ}/branches/${BRANCH}/products/${productId}/e2e-story.jpg`;
  const up = await fetch(`http://127.0.0.1:9199/upload/storage/v1/b/qareeb-dev.firebasestorage.app/o?uploadType=media&name=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: readFileSync(photo(file)) });
  if (!up.ok) throw new Error(`upload: ${up.status}`);
  for (const doc of [`businesses/${BIZ}/branches/${BRANCH}/products/${productId}`, `publicBranches/${BRANCH}/products/${productId}`]) {
    const res = await fetch(`${FS}/${doc}?updateMask.fieldPaths=imagePath`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { imagePath: { stringValue: path } } }) });
    if (!res.ok) throw new Error(`patch ${doc}: ${res.status}`);
  }
}
const photo = (name: string) => fileURLToPath(new URL(`../assets/morano-menu-photos/web-jpg-1200/${name}`, import.meta.url));

async function publish(page: Page, file: string, caption: string, dish?: string) {
  await page.goto(`/business/${BIZ}/${BRANCH}/posts`);
  await expect(page.getByRole('heading', { name: 'Stories' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(photo(file));
  await expect(page.locator('.px-photo img')).toBeVisible();
  await page.getByLabel(/^Caption/).fill(caption);
  if (dish) await page.getByLabel(/^Linked dish/).selectOption({ label: dish });
  await page.getByRole('button', { name: 'Publish for 24 hours' }).click();
  await expect(page.getByText('Post published')).toBeVisible();
  await expect(page.getByRole('article', { name: caption })).toBeVisible();
}

async function removeAll(page: Page, biz = BIZ, branch = BRANCH) {
  await page.goto(`/business/${biz}/${branch}/posts`);
  await expect(page.getByRole('heading', { name: 'Stories' })).toBeVisible();
  const del = page.getByRole('button', { name: 'Delete post' });
  // Wait for the live list to load: counting before it arrives reads zero and deletes nothing.
  await expect(page.getByText('No live posts').or(del.first())).toBeVisible();
  while (await del.count()) {
    const before = await del.count();
    await del.first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(del).toHaveCount(before - 1);
  }
}

test.describe('stories', () => {
  test.beforeEach(async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'owner.restaurant@qareeb.test');
    await removeAll(page);
  });
  test.afterEach(async ({ page }) => { await removeAll(page); });

  test('a customer plays a store story from the home page circles and orders the linked dish', async ({ page, browser }) => {
    await publish(page, '14_ציפס_גדול.jpg', 'Fries just came out', 'Fries');
    await publish(page, '38_פיצה_נפוליטנית_קלאסית.jpg', 'Pizza night');

    const guest = await browser.newPage();
    await setLocale(guest, 'en');
    await guest.goto('/');
    const circle = guest.getByRole('navigation', { name: 'Stories' }).getByRole('button', { name: 'View Abu Salim Shawarma’s story' });
    await expect(circle).toBeVisible();
    await expect(circle).toHaveClass(/story-circle--fresh/);

    await circle.click();
    const viewer = guest.getByRole('dialog', { name: 'Abu Salim Shawarma · 1 of 2' });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('Fries just came out');
    await expect(viewer.locator('.story-bar')).toHaveCount(2);

    // Ordering pauses the story and goes through the usual product sheet.
    await viewer.getByRole('button', { name: /Order/ }).click();
    const sheet = guest.getByRole('dialog', { name: 'Fries' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /Add to cart/ }).click();
    await expect(sheet).toBeHidden();
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText('Fries just came out');

    // Next photo (keyboard), then it plays on by itself and closes after the last one.
    await viewer.getByRole('button', { name: 'Close' }).focus();
    await guest.keyboard.press('ArrowRight');
    await expect(guest.getByRole('dialog', { name: 'Abu Salim Shawarma · 2 of 2' })).toContainText('Pizza night');
    await expect(guest.getByRole('dialog', { name: /Abu Salim Shawarma/ })).toBeHidden({ timeout: 12_000 });

    // Seen: the ring settles, and the cart kept the dish.
    await expect(circle).not.toHaveClass(/story-circle--fresh/);
    await expect(guest.locator('.bottom-nav__count').first()).toHaveText('1');

    // Pausing stops the clock; Escape closes.
    await circle.click();
    const again = guest.getByRole('dialog', { name: /Abu Salim Shawarma · 1 of 2/ });
    await again.getByRole('button', { name: 'Pause' }).click();
    await guest.waitForTimeout(7000);
    await expect(again).toBeVisible();
    await expect(again).toContainText('Fries just came out');
    await guest.keyboard.press('Escape');
    await expect(again).toBeHidden();
    await guest.close();
  });

  test('an owner puts menu items in the store\'s stories from the catalog, and customers order them there', async ({ page, browser }) => {
    await givePhoto('p-fries', '14_ציפס_גדול.jpg');
    await page.goto(`/business/${BIZ}/${BRANCH}/catalog`);
    const fries = page.getByRole('button', { name: 'In stories: Fries' });
    await expect(fries).toHaveAttribute('aria-pressed', 'false');
    // An item without a photo cannot join.
    await expect(page.getByRole('button', { name: 'In stories: Cola 330ml' })).toBeDisabled();
    await fries.click();
    await expect(fries).toHaveAttribute('aria-pressed', 'true');

    const guest = await browser.newPage();
    await setLocale(guest, 'en');
    await guest.goto('/');
    const circle = guest.getByRole('navigation', { name: 'Stories' }).getByRole('button', { name: 'View Abu Salim Shawarma’s story' });
    await expect(circle).toHaveClass(/story-circle--fresh/);
    await circle.click();
    const viewer = guest.getByRole('dialog', { name: 'Abu Salim Shawarma · 1 of 1' });
    await expect(viewer).toContainText('Fries');
    await expect(viewer).toContainText('From the menu');
    await viewer.getByRole('button', { name: /Add to cart/ }).click();
    const sheet = guest.getByRole('dialog', { name: 'Fries' });
    await sheet.getByRole('button', { name: /Add to cart/ }).click();
    await expect(sheet).toBeHidden();
    await guest.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(guest.locator('.bottom-nav__count').first()).toHaveText('1');

    // The item editor has the same switch; turning it off there takes the item out of the story.
    await page.getByRole('button', { name: 'Edit: Fries' }).click();
    const editor = page.getByRole('dialog');
    const sw = editor.getByRole('switch', { name: 'In stories' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(fries).toHaveAttribute('aria-pressed', 'false');
    await guest.reload();
    await expect(guest.getByText('Abu Salim Shawarma').first()).toBeVisible();
    await expect(guest.getByRole('navigation', { name: 'Stories' })).toHaveCount(0);
    await guest.close();
  });

  test('the home page has no stories row when no store has a live post', async ({ browser }) => {
    // The market may have posts from other runs; clear them as its owner too.
    const market = await browser.newPage();
    await setLocale(market, 'en');
    await signInEmail(market, 'owner.market@qareeb.test');
    await removeAll(market, 'biz-beit-jann-market', 'br-market-main');
    await market.close();
    const guest = await browser.newPage();
    await setLocale(guest, 'en');
    await guest.goto('/');
    await expect(guest.getByText('Abu Salim Shawarma').first()).toBeVisible();
    await expect(guest.getByRole('navigation', { name: 'Stories' })).toHaveCount(0);
    await guest.close();
  });

  test('the discover tab is gone and its old link lands on the home page', async ({ browser }) => {
    const guest = await browser.newPage();
    await setLocale(guest, 'en');
    await guest.goto('/explore');
    await expect(guest).toHaveURL(/\/$/);
    await expect(guest.getByRole('link', { name: 'Discover' })).toHaveCount(0);
    await guest.close();
  });

  for (const locale of ['he', 'ar', 'en'] as const) {
    for (const width of [390, 1440]) {
      test(`home page with stories has no runtime errors or horizontal overflow: ${locale}, ${width}px`, async ({ page, browser }) => {
        await publish(page, '26_פתוש_גדול.jpg', `Overflow ${locale} ${width}`);
        const guest = await browser.newPage({ viewport: { width, height: 900 } });
        await setLocale(guest, locale);
        const errors: string[] = [];
        guest.on('pageerror', (error) => errors.push(error.message));
        await guest.goto('/');
        const circle = guest.locator('.story-circle').first();
        await expect(circle).toBeVisible();
        expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await circle.click();
        const viewer = guest.locator('dialog.story-viewer');
        await expect(viewer).toBeVisible();
        // Every control of the viewer stays inside its frame.
        const escaped = await viewer.evaluate((d) => {
          const frame = d.querySelector('.story-frame')!.getBoundingClientRect();
          return Array.from(d.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.left < frame.left - 1 || r.right > frame.right + 1 || r.top < frame.top - 1 || r.bottom > frame.bottom + 1); }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
        });
        expect(escaped).toEqual([]);
        await guest.keyboard.press('Escape');
        expect(errors).toEqual([]);
        await guest.close();
      });
    }
  }
});
