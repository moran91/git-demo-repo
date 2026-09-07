import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { setLocale, signInEmail, signInAsCustomer } from './helpers';

const widths = [360, 390, 768, 1440];
const locales = ['he', 'ar', 'en'] as const;
const out = '../docs/screenshots';

async function shot(page: Page, name: string) {
  fs.mkdirSync(out, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

for (const locale of locales) {
  for (const w of widths) {
    test(`design review ${locale} @${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w < 500 ? 780 : 900 });
      await setLocale(page, locale);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `discovery-${locale}-${w}`);
      await page.goto('/b/biz-abu-salim/br-abu-salim-main');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `business-${locale}-${w}`);
      await page.getByRole('button', { name: /Shawarma|שווארמה|شاورما/ }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `product-options-${locale}-${w}`);
      await page.keyboard.press('Escape');
      if (locale === 'en' || w === 390) {
        await signInAsCustomer(page, 'seed-customer1');
        await page.goto('/b/biz-abu-salim/br-abu-salim-main');
        await page.getByRole('button', { name: /Fries|צ׳יפס|بطاطا/ }).first().click();
        await page.getByRole('dialog').getByRole('button', { name: /Add to cart|הוספה לסל|إضافة إلى السلة/ }).click();
        await page.goto('/checkout');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await shot(page, `checkout-${locale}-${w}`);
        await page.getByRole('button', { name: /New address|כתובת חדשה|عنوان جديد/ }).click();
        await shot(page, `address-form-${locale}-${w}`);
        await page.keyboard.press('Escape');
        await page.goto('/orders');
        const first = page.locator('a.card').first();
        if (await first.count()) {
          await first.click();
          await shot(page, `order-detail-${locale}-${w}`);
        }
      }
    });
  }
}

test('dashboards @1440 and @390 in three languages', async ({ page }) => {
  for (const locale of locales) {
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: w < 500 ? 780 : 900 });
      await setLocale(page, locale);
      await signInEmail(page, 'owner.restaurant@qareeb.test');
      await page.goto('/business/biz-abu-salim/br-abu-salim-main/orders');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `dash-orders-${locale}-${w}`);
      await page.goto('/business/biz-abu-salim/br-abu-salim-main/printers');
      await shot(page, `dash-printers-${locale}-${w}`);
      await page.goto('/business/biz-abu-salim/br-abu-salim-main/catalog');
      await shot(page, `dash-catalog-${locale}-${w}`);
      await page.evaluate(() => localStorage.clear());
      await signInEmail(page, 'admin@qareeb.test');
      await page.goto('/admin/approvals');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `admin-approvals-${locale}-${w}`);
      await page.context().clearCookies();
      await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('firebaseLocalStorageDb'); });
    }
  }
});
