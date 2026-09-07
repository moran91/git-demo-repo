import { test, expect } from '@playwright/test';
import { setLocale, signInAsCustomer, fsQuery } from './helpers';

test.describe('customer storefront', () => {
  test('browses Beit Jann as a guest in Hebrew (RTL), switches to English (LTR) and Arabic, sees only approved businesses', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('דברים טובים. קרוב לבית.');
    await expect(page.getByText('שווארמה אבו סלים').first()).toBeVisible();
    await expect(page.getByText('مخبز الجبل')).toHaveCount(0); // pending business hidden
    // Supermarkets tab
    await page.getByRole('radio', { name: 'סופרמרקטים' }).click();
    await expect(page.getByText('מרכול בית ג׳ן').first()).toBeVisible();
    // Pickup mode shows only branches physically in Beit Jann
    await page.getByRole('radio', { name: 'איסוף עצמי' }).click();
    await page.getByRole('radio', { name: 'מסעדות' }).click();
    await expect(page.getByText('סניף ראשי – בית ג׳ן')).toBeVisible();
    await expect(page.getByText('סניף חורפיש')).toHaveCount(0);
    // Language switch preserves route and direction flips
    await page.getByLabel('שפה').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good things. Close to home.');
    await page.getByLabel('Language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أشياء طيّبة. قريبة من البيت.');
  });

  test('builds a restaurant order with modifiers, persists the cart through sign-in, and completes delivery checkout with only house description + recipient + phone', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/b/biz-abu-salim/br-abu-salim-main');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Abu Salim Shawarma');
    await page.getByRole('button', { name: /Add to cart: Shawarma/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Required bread group blocks submission until chosen
    await dialog.getByRole('button', { name: /Add to cart/ }).click();
    await expect(dialog.getByText('Please complete the required selections.')).toBeVisible();
    await dialog.getByLabel('Laffa').check();
    await dialog.getByLabel('Fries inside').check();
    await dialog.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(dialog.getByRole('button', { name: /Add to cart/ })).toContainText('₪86');
    await dialog.getByRole('button', { name: /Add to cart/ }).click();
    await expect(page.locator('.cart-bar')).toContainText('2 items');
    await page.goto('/cart');
    await expect(page.getByText('Laffa, Fries inside')).toBeVisible();
    await expect(page.locator('.summary')).toContainText('₪86');
    await page.getByRole('button', { name: 'Go to checkout' }).click();
    // Guest → phone verification gate; cart survives sign-in
    await expect(page.getByText('Sign in with your phone to place the order')).toBeVisible();
    await signInAsCustomer(page, 'seed-customer2');
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: 'Your house, in your words.' })).toBeVisible();
    await page.getByRole('button', { name: 'New address' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('How do we find your house?').fill('Behind the mosque, green gate, ask for Jaber family');
    await form.getByLabel('Recipient name').fill('Maha Jaber');
    await form.getByLabel('Recipient phone').fill('0502222222');
    await form.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Behind the mosque, green gate').first()).toBeVisible();
    await expect(page.getByText('Cash on delivery')).toBeVisible();
    await page.getByLabel('Contact phone').fill('0502222222');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText('Order placed')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.order-ref')).toHaveText(/^Q-[A-Z2-9]{5}$/);
    await expect(page.getByText('Placed — awaiting acceptance')).toBeVisible();
    await expect(page.getByRole('link', { name: /Call business/ })).toHaveAttribute('href', 'tel:+972501234567');
    const ref = await page.locator('.order-ref').textContent();
    const rows = await fsQuery('orders', [{ field: 'reference', op: 'EQUAL', value: ref! }]);
    expect(rows.length).toBe(1);
    const address = rows[0]!.address as Record<string, unknown>;
    expect(String(address.houseDescription)).toContain('green gate');
    expect(address.street).toBeUndefined();
  });

  test('replacing the cart from another business asks for confirmation', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/b/biz-abu-salim/br-abu-salim-main');
    await page.getByRole('button', { name: /Add to cart: Fries/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Add to cart/ }).click();
    await page.goto('/b/biz-beit-jann-market/br-market-main');
    await page.getByRole('button', { name: /Add to cart: Milk/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Add to cart/ }).click();
    await expect(page.getByText('Replace your cart?')).toBeVisible();
    await page.getByRole('button', { name: 'Replace cart' }).click();
    await page.goto('/cart');
    await expect(page.getByText('From Beit Jann Market')).toBeVisible();
  });

  test('deep link to an unknown page shows the not-found state', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/this/does/not/exist');
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
