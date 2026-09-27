import { test, expect } from '@playwright/test';
import { setLocale, signInAsCustomer } from './helpers';

test.describe('platform admin inside businesses', () => {
  test('opens a business from the admin panel, acts in it, and the action is audited', async ({ page }) => {
    await setLocale(page, 'en');
    await signInAsCustomer(page, 'seed-admin');
    await page.goto('/admin/businesses');
    await page.getByRole('row', { name: /Abu Salim Shawarma/ }).getByRole('link', { name: 'Open dashboard' }).click();
    await expect(page).toHaveURL(/\/business\/biz-abu-salim\/[^/]+\/orders/);
    await expect(page.getByText('Admin mode · Abu Salim Shawarma')).toBeVisible();
    // The switcher lists businesses the admin is not a member of.
    await expect(page.getByRole('combobox', { name: 'Business', exact: true }).locator('option', { hasText: 'Beit Jann Market' })).toHaveCount(1);
    await page.getByRole('button', { name: /· Pause new orders$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pause new orders', exact: true }).click();
    await expect(page.getByRole('button', { name: /· Resume orders$/ })).toBeVisible();
    await page.getByRole('button', { name: /· Resume orders$/ }).click();
    await expect(page.getByRole('button', { name: /· Pause new orders$/ })).toBeVisible();
    await page.getByRole('link', { name: 'Back to admin' }).click();
    await expect(page).toHaveURL(/\/admin\/businesses\/biz-abu-salim$/);
    await page.goto('/admin/audit');
    await expect(page.getByText('admin.setOrdersPaused').first()).toBeVisible();
  });

  test('a pending business opens for the admin', async ({ page }) => {
    await setLocale(page, 'en');
    await signInAsCustomer(page, 'seed-admin');
    await page.goto('/business/biz-pending-bakery');
    await expect(page.getByText('Admin mode · Mountain Bakery')).toBeVisible();
  });

  test('the owner of a business never sees the admin banner', async ({ page }) => {
    await setLocale(page, 'en');
    await signInAsCustomer(page, 'seed-owner1');
    await page.goto('/business/biz-abu-salim');
    await expect(page.getByRole('heading', { name: 'Incoming orders' })).toBeVisible();
    await expect(page.getByText(/Admin mode/)).toHaveCount(0);
  });
});
