import { expect, test } from '@playwright/test';
import { fsGet, setLocale, signInEmail } from './helpers';

const base = '/business/biz-abu-salim/br-abu-salim-main';

test.beforeEach(async ({ page }) => {
  await setLocale(page, 'en');
  await signInEmail(page, 'owner.restaurant@qareeb.test');
});

for (const width of [360, 1440]) {
  test(`deals tabs expose only the selected content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/deals`);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'New combo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New promotion', exact: true })).toBeHidden();
    await page.getByRole('tab', { name: /Promotions/ }).click();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'New promotion', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New combo', exact: true })).toBeHidden();
  });
}

test('availability saves immediately and survives reload without changing the product price', async ({ page }) => {
  await page.goto(`${base}/catalog`);
  const path = 'businesses/biz-abu-salim/branches/br-abu-salim-main/products/p-cola';
  const before = await fsGet(path);
  const toggle = page.getByRole('switch', { name: 'Available to order: Cola 330ml', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(!before!.available));
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', String(!before!.available));
  expect((await fsGet(path))!.priceAgorot).toBe(before!.priceAgorot);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(before!.available));
});

test('the editor language switch supports keyboard selection and retains each language', async ({ page }) => {
  await page.goto(`${base}/catalog`);
  await page.getByRole('button', { name: 'New product', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  const tabs = editor.getByRole('tablist', { name: 'Language' });
  await editor.getByRole('textbox', { name: 'Name English', exact: true }).fill('Draft English');
  await tabs.getByRole('tab', { name: /English/ }).focus();
  await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab', { name: /Hebrew/ })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: /Hebrew/ })).toContainText('Missing text');
  await editor.getByRole('textbox', { name: 'Name Hebrew', exact: true }).fill('טיוטה');
  await tabs.getByRole('tab', { name: /English/ }).click();
  await expect(editor.getByRole('textbox', { name: 'Name English', exact: true })).toHaveValue('Draft English');
});

test('reorder mode moves an item with the keyboard and by dragging, and the order persists', async ({ page }) => {
  const sides = 'businesses/biz-abu-salim/branches/br-abu-salim-main/products';
  const order = async () => [(await fsGet(`${sides}/p-fries`))!.sortOrder as number, (await fsGet(`${sides}/p-knafeh`))!.sortOrder as number];
  await page.goto(`${base}/catalog`);
  await page.getByRole('button', { name: 'Reorder', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reorder menu' })).toBeVisible();
  const fries = page.getByRole('button', { name: 'Move: Fries', exact: true });
  const [f0, k0] = await order();
  expect(f0).toBeLessThan(k0!);
  await fries.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => { const [f, k] = await order(); return f! > k!; }).toBe(true);
  // Drag Fries back above the other side dish.
  const from = (await fries.boundingBox())!;
  const other = (await page.locator('.csec__list .irow').filter({ hasNot: page.getByRole('button', { name: 'Move: Fries' }) }).filter({ has: page.locator('text=كنافة') }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let y = from.y + from.height / 2; y > other.y - 4; y -= 6) await page.mouse.move(from.x + from.width / 2, y);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(async () => { const [f, k] = await order(); return f! < k!; }).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reorder', exact: true })).toBeVisible();
});
