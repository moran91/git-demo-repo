import { test, expect, type Page } from '@playwright/test';
import { setLocale, signInAsCustomer } from './helpers';

/** The globe menu is the app's only language control: one per screen, no segmented or extra pickers. */
async function expectOnlyGlobe(page: Page) {
  await expect(page.getByRole('button', { name: /^Language:/ })).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Language' })).toHaveCount(0);
}

test.describe('one language control everywhere', () => {
  test.beforeEach(async ({ page }) => { await setLocale(page, 'en'); });

  test('customer pages and account', async ({ page }) => {
    await page.goto('/');
    await expectOnlyGlobe(page);
    await page.goto('/account');
    await expectOnlyGlobe(page);
  });

  test('staff sign-in', async ({ page }) => {
    await page.goto('/business/signin');
    await expectOnlyGlobe(page);
  });

  test('business dashboard: desktop sidebar opens upward and switches; phone More page has none', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAsCustomer(page, 'seed-owner1');
    await page.goto('/business/biz-abu-salim');
    await expect(page).toHaveURL(/\/business\/biz-abu-salim\/[^/]+\/orders/);
    await expectOnlyGlobe(page);
    await page.getByRole('button', { name: /^Language:/ }).click();
    const menu = page.getByRole('menu', { name: 'Language' });
    const box = (await menu.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    await page.getByRole('menuitemradio', { name: 'עברית' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: /^שפה:/ }).click();
    const rtlBox = (await page.getByRole('menu', { name: 'שפה' }).boundingBox())!;
    expect(rtlBox.x).toBeGreaterThanOrEqual(0);
    expect(rtlBox.x + rtlBox.width).toBeLessThanOrEqual(1280);
    await page.getByRole('menuitemradio', { name: 'English' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    const url = page.url().replace(/\/orders$/, '/more');
    await page.goto(url);
    await expect(page.getByRole('button', { name: /^Language:/ })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Language' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: /^Language:/ })).toBeVisible();
  });

  test('admin panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAsCustomer(page, 'seed-admin');
    await page.goto('/admin');
    await expectOnlyGlobe(page);
  });
});
