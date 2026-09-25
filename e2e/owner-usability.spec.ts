import { test, expect } from '@playwright/test';
import { fsGet, setLocale, signInAsCustomer, signInEmail } from './helpers';

const base = '/business/biz-abu-salim/br-abu-salim-main';

test('a signed-in phone customer can switch to their business email account', async ({ page }) => {
  await setLocale(page, 'en');
  await signInAsCustomer(page);
  await page.goto('/business/new');
  await expect(page).toHaveURL(/\/business\/signin$/);
  await signInEmail(page, 'owner.restaurant@qareeb.test');
  await page.goto(`${base}/orders`);
  await expect(page.getByRole('heading', { name: 'Incoming orders', exact: true })).toBeVisible();
});

test.describe('owner usability regressions', () => {
  test.beforeEach(async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'owner.restaurant@qareeb.test');
  });

  test('a new product takes a photo before its first save, and updates the same product', async ({ page }) => {
    await page.goto(`${base}/catalog`);
    await page.getByRole('button', { name: 'New product', exact: true }).first().click();
    const editor = page.getByRole('dialog');
    const name = `Owner regression ${Date.now()}`;
    await editor.getByRole('textbox', { name: 'Name English', exact: true }).fill(name);
    await editor.getByRole('spinbutton', { name: 'Base price' }).fill('12.50');
    // The photo is held until the first save, then uploaded to the new product.
    await expect(editor.locator('input[type="file"]')).toBeEnabled();
    await editor.locator('input[type="file"]').setInputFiles('../apps/web/public/icons/icon-192.png');
    await expect(editor.getByRole('button', { name: 'Remove photo', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByLabel('Find a product or category').fill(name);
    await expect(page.locator('.list__item--catalog')).toHaveCount(1);
    await page.getByRole('button', { name: `Edit: ${name}`, exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Remove photo', exact: true })).toBeVisible();
    await editor.getByRole('spinbutton', { name: 'Base price' }).fill('14.50');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator('.list__item--catalog')).toHaveCount(1);
    await expect(page.locator('.list__item--catalog')).toContainText('14.50');
    await page.reload();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByLabel('Find a product or category').fill(name);
    await expect(page.locator('.list__item--catalog')).toHaveCount(1);
    await page.goto('/b/biz-abu-salim/br-abu-salim-main');
    await page.getByRole('button', { name: `Add to cart: ${name}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Add to cart/ }).click();
    await page.goto('/cart');
    await page.getByRole('button', { name: `Photo of ${name}`, exact: true }).click();
    const photo = page.getByRole('dialog', { name: `Photo of ${name}`, exact: true });
    await expect(photo.locator('img')).toBeVisible();
    await expect.poll(() => photo.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(photo).toHaveCount(0);
  });

  test('map selection is deliberate, persists, and an unrelated pause preserves edits', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 32.9628, longitude: 35.3822 });
    await page.goto(`${base}/branch`);
    const name = page.getByRole('textbox', { name: 'Branch name English', exact: true });
    const original = await name.inputValue();
    await name.fill(`${original} draft`);
    await page.getByRole('button', { name: /· Pause new orders$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pause new orders', exact: true }).click();
    await expect(page.getByRole('button', { name: /· Resume orders$/ })).toBeVisible();
    await expect(name).toHaveValue(`${original} draft`);
    await page.getByRole('button', { name: /· Resume orders$/ }).click();
    await name.fill(original);
    await page.getByRole('button', { name: /^(Choose on map|Change location on map)$/ }).click();
    const map = page.getByRole('dialog', { name: 'Choose a location' });
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await map.getByRole('button', { name: 'Use my location', exact: true }).click();
    await expect(map.getByRole('button', { name: 'Use this location', exact: true })).toBeEnabled();
    await map.locator('.location-map').click({ position: { x: 90, y: 110 } });
    await expect(map.locator('.location-marker')).toBeVisible();
    await map.getByRole('button', { name: 'Use this location', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Your changes are saved.')).toBeVisible();
    const saved = await fsGet('businesses/biz-abu-salim/branches/br-abu-salim-main');
    expect(saved?.lat).toBeGreaterThan(32.9);
    expect(saved?.lat).toBeLessThan(33);
    await page.getByRole('button', { name: 'Remove map location', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Your changes are saved.')).toBeVisible();
    const cleared = await fsGet('businesses/biz-abu-salim/branches/br-abu-salim-main');
    expect(cleared?.lat).toBeUndefined();
    expect(cleared?.lng).toBeUndefined();
  });

  test('unsaved settings stay put when navigation is cancelled; branch switches preserve the page', async ({ page }) => {
    await page.goto(`${base}/branch`);
    const name = page.getByRole('textbox', { name: 'Branch name English', exact: true });
    await name.fill('Unsaved branch name');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(name).toHaveValue('Unsaved branch name');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('br-abu-salim-hurfeish');
    await expect(page).toHaveURL(/br-abu-salim-hurfeish\/branch$/);
    await expect(page.getByRole('textbox', { name: 'Branch name English', exact: true })).not.toHaveValue('Unsaved branch name');
  });

  test('overnight hours normalize when opening time changes and reject overlapping ranges', async ({ page }) => {
    await page.goto(`${base}/branch`);
    const sunday = page.locator('.hours-day').first();
    await sunday.getByLabel('From', { exact: true }).fill('18:00');
    await sunday.getByLabel('To', { exact: true }).fill('01:00');
    await expect(sunday.getByText('Ends the next day')).toBeVisible();
    await sunday.getByLabel('From', { exact: true }).fill('00:30');
    await expect(sunday.getByText('Ends the next day')).toHaveCount(0);
    await sunday.getByRole('button', { name: 'Add interval' }).click();
    await sunday.getByLabel('From', { exact: true }).nth(1).fill('00:45');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Time ranges must not overlap');
  });

  test('browser Back preserves a draft when cancelled and leaves when confirmed', async ({ page }) => {
    await page.goto(`${base}/catalog`);
    await page.getByRole('link', { name: 'Branch settings', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Branch name English', exact: true });
    await name.fill('Keep my draft');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/branch$/);
    await expect(name).toHaveValue('Keep my draft');
    page.once('dialog', (dialog) => dialog.accept());
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test('saving a new branch opens its settings without a discard warning', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.goto('/business/biz-abu-salim/_/branches/new');
    const name = `New branch ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Branch name English', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Branch phone (shown to customers on orders)', exact: true }).fill('0501234567');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/business\/biz-abu-salim\/[^/]+\/branch$/);
    await expect(page.getByRole('textbox', { name: 'Branch name English', exact: true })).toHaveValue(name);
    expect(dialogs).toEqual([]);
  });

  test('mobile navigation traps focus, closes with Escape, and restores the opener', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/orders`);
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Menu', exact: true });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();
    await menu.click();
    await drawer.getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
    await expect(drawer).toHaveCount(0);
  });

  test('choosing a combo size does not add an item until Add is pressed', async ({ page }) => {
    await page.goto(`${base}/deals`);
    await page.getByRole('button', { name: 'New combo', exact: true }).click();
    await page.getByRole('button', { name: 'Add items from the menu', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add items from the menu', exact: true });
    const row = picker.locator('.picker-row').filter({ hasText: 'Falafel plate' });
    await row.getByRole('combobox').selectOption('v-large');
    await expect(row.locator('.btn--add__count')).toHaveCount(0);
    await row.getByRole('button', { name: 'Add: Falafel plate', exact: true }).click();
    await expect(row.locator('.btn--add__count')).toHaveText('1');
    await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Falafel plate (Large)');
  });
});

for (const locale of ['he', 'ar', 'en'] as const) {
  for (const width of [390, 1440]) {
    test(`owner pages have no runtime errors or horizontal overflow: ${locale}, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setLocale(page, locale);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await signInEmail(page, 'owner.restaurant@qareeb.test');
      for (const section of ['orders', 'history', 'catalog', 'catalog/extras', 'deals', 'posts', 'branch', 'business', 'staff', 'loyalty', 'cash', 'printers', 'qr']) {
        await page.goto(`${base}/${section}`);
        await expect(page.locator('.dash__main h1')).toBeVisible();
        await expect(page.locator('.dash__main [role="alert"]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), section).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }
}
