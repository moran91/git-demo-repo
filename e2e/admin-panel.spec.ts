import { test, expect } from '@playwright/test';
import { setLocale, signInAsCustomer } from './helpers';

test.describe('platform admin panel', () => {
  test.beforeEach(async ({ page }) => {
    await setLocale(page, 'en');
    await signInAsCustomer(page, 'seed-admin');
  });

  test('nav groups carry the pending-approval count; the drawer closes with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer.getByText('Operations')).toBeVisible();
    await expect(drawer.getByRole('link', { name: /^Approvals\s*\d+$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('businesses show owners by name and filter by status; detail links to the owner page', async ({ page }) => {
    await page.goto('/admin/businesses');
    const row = page.getByRole('row', { name: /Abu Salim Shawarma/ });
    await expect(row.getByRole('link', { name: 'Salim Khatib' })).toBeVisible();
    await page.getByRole('button', { name: /^Pending/ }).click();
    await expect(page.getByRole('row', { name: /Abu Salim Shawarma/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Mountain Bakery/ })).toBeVisible();
    await page.goto('/admin/businesses/biz-abu-salim');
    await expect(page.getByRole('heading', { name: 'Owner' })).toBeVisible();
    await page.getByRole('link', { name: 'Salim Khatib' }).first().click();
    await expect(page).toHaveURL(/\/admin\/users\/seed-owner1$/);
    await expect(page.getByText('owner.restaurant@qareeb.test')).toBeVisible();
  });

  test('user search accepts a local phone number and a name prefix', async ({ page }) => {
    await page.goto('/admin/users');
    const search = page.getByPlaceholder('Name, email or phone');
    await search.fill('050-111-1111');
    await search.press('Enter');
    await expect(page.locator('main tbody tr')).toHaveCount(1);
    await search.fill('Rania');
    await search.press('Enter');
    await expect(page.getByRole('link', { name: 'Rania Saad' })).toBeVisible();
    await search.fill('nobody-by-this-name');
    await search.press('Enter');
    await expect(page.getByText('No results')).toBeVisible();
  });

  test('inviting an owner hands the admin a link to deliver, listed as pending', async ({ page }) => {
    await page.goto('/admin/invitations');
    const email = `e2e.owner.${Date.now()}@qareeb.test`;
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Create invitation link' }).click();
    await expect(page.locator('.admin-linkpanel code')).toContainText('/business/invite/');
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
    await expect(page.locator('main .list__item', { hasText: email }).getByText('Pending')).toBeVisible();
  });

  test('settings show no untranslated monetization line', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/admin/config');
    await expect(page.getByRole('heading', { name: 'הגדרות פלטפורמה' })).toBeVisible();
    await expect(page.getByText(/Subscriptions:|Commission:/)).toHaveCount(0);
  });
});
