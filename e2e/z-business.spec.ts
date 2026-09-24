import { test, expect } from '@playwright/test';
import { fsQuery, fsGet, setLocale, signInEmail } from './helpers';

test.describe('business dashboard', () => {
  test('manager accepts the incoming order and walks it across the board: New → Preparing → Ready → done', async ({ page }) => {
    await setLocale(page, 'en');
    await signInEmail(page, 'manager.a@qareeb.test');
    await page.goto('/business/biz-abu-salim/br-abu-salim-main/orders');
    await expect(page.getByRole('heading', { name: 'Incoming orders' })).toBeVisible();
    const placed = await fsQuery('orders', [{ field: 'branchId', op: 'EQUAL', value: 'br-abu-salim-main' }, { field: 'status', op: 'EQUAL', value: 'placed' }, { field: 'mode', op: 'EQUAL', value: 'delivery' }], 1);
    test.skip(placed.length === 0, 'needs a placed order from the customer spec');
    const ref = placed[0]!.reference as string;
    const card = page.locator('.order-card', { hasText: ref });
    await expect(card).toBeVisible();
    // The board card is a tap target only: contents and the address live on the detail page.
    await expect(card.getByText('How to find the house')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Accept order' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reject order' })).toBeVisible();
    await card.getByRole('button', { name: 'Print order' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Print preview' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await card.getByRole('button', { name: 'Accept order' }).click();
    // Desktop viewport: all three columns are visible, so the card moves into "Preparing" in place.
    const preparing = page.locator('#board-col-preparing .order-card', { hasText: ref });
    await expect(preparing).toBeVisible();
    await expect(page.locator('#board-col-new .order-card', { hasText: ref })).toHaveCount(0);
    let after = await fsGet(`orders/${placed[0]!.id}`);
    expect(after!.status).toBe('accepted');
    expect(after!.stage).toBe('preparing');
    await preparing.getByRole('button', { name: 'Mark ready' }).click();
    const ready = page.locator('#board-col-ready .order-card', { hasText: ref });
    await expect(ready).toBeVisible();
    await expect(ready.getByRole('button', { name: 'Back to preparing' })).toBeVisible();
    await ready.getByRole('button', { name: 'Delivered' }).click();
    await expect(page.locator('.order-card', { hasText: ref })).toHaveCount(0);
    after = await fsGet(`orders/${placed[0]!.id}`);
    expect(after!.stage).toBe('completed');
    expect(after!.completedAt).toBeTruthy();
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
