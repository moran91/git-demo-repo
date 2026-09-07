import { test, expect } from '@playwright/test';
import { fsQuery, fsGet, setLocale, signInEmail } from './helpers';

test.describe('business dashboard', () => {
  test('manager sees the incoming order in real time and accepts it; status shows Accepted', async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'manager.a@qareeb.test');
    await page.goto('/business/biz-abu-salim/br-abu-salim-main/orders');
    await expect(page.getByRole('heading', { name: 'Incoming orders' })).toBeVisible();
    const placed = await fsQuery('orders', [{ field: 'branchId', op: 'EQUAL', value: 'br-abu-salim-main' }, { field: 'status', op: 'EQUAL', value: 'placed' }], 1);
    test.skip(placed.length === 0, 'needs a placed order from the customer spec');
    const ref = placed[0]!.reference as string;
    const card = page.locator('.order-card', { hasText: ref });
    await expect(card).toBeVisible();
    await expect(card.getByText('How to find the house')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept order' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reject order' })).toBeVisible();
    await card.getByRole('button', { name: 'Print order' }).click();
    await expect(page.getByRole('dialog')).toContainText('Awaiting acceptance');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await card.getByRole('button', { name: 'Accept order' }).click();
    await expect(page.locator('.order-card', { hasText: ref })).toHaveCount(0);
    const after = await fsGet(`orders/${placed[0]!.id}`);
    expect(after!.status).toBe('accepted');
  });

  test('staff limited to branch B cannot open branch A', async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'staff.b@qareeb.test');
    await page.goto('/business/biz-abu-salim/br-abu-salim-main/orders');
    await expect(page).toHaveURL(/br-abu-salim-hurfeish/);
    await expect(page.getByRole('link', { name: 'Catalog' })).toHaveCount(0);
  });

  test('admin sees pending approvals', async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'admin@qareeb.test');
    await page.goto('/admin/approvals');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
    await expect(page.getByText('Mountain Bakery')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('Acceptance is not revenue.')).toBeVisible();
  });
});
