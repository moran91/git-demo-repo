import { test, expect } from '@playwright/test';
import { setLocale, signInAsCustomer } from './helpers';

test.beforeEach(async ({ page }) => { await setLocale(page, 'en'); });

test('location detection updates discovery, remembers opt-in and respects a later manual choice', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 33.0167, longitude: 35.35 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.city-pill')).toContainText('Hurfeish');
  await expect(page.getByText('Location detection is on', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('qareeb.discovery.v1')!));
  expect(stored.cityId).toBe('hurfeish');
  expect(stored.locationEnabled).toBe(true);
  expect(stored.latitude).toBeUndefined();
  expect(stored.longitude).toBeUndefined();

  await context.setGeolocation({ latitude: 32.9628, longitude: 35.3822 });
  await page.reload();
  await expect(page.locator('.city-pill')).toContainText('Beit Jann');
  await page.locator('.city-pill').click();
  await page.getByRole('option', { name: 'Hurfeish', exact: true }).click();
  await page.reload();
  await expect(page.locator('.city-pill')).toContainText('Hurfeish');
  await expect(page.getByText('Location detection is on', { exact: true })).toHaveCount(0);
});

for (const failure of [{ code: 1, text: 'Location permission is off.' }, { code: 2, text: 'We could not find your location.' }, { code: 3, text: 'Finding your location took too long.' }]) {
  test(`geolocation failure ${failure.code} explains recovery and allows manual selection`, async ({ page }) => {
    await page.addInitScript((code) => {
      navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code, message: 'test', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    }, failure.code);
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(failure.text);
    await page.getByRole('option', { name: 'Hurfeish', exact: true }).click();
    await expect(page.locator('.city-pill')).toContainText('Hurfeish');
  });
}

test('a position outside the service area does not silently change the town', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('We could not find a supported town near you.');
  await expect(page.locator('.city-pill')).toContainText('Beit Jann');
});

test('a returning user sees a failed automatic location lookup and can choose a town', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await page.addInitScript(() => {
    localStorage.setItem('qareeb.discovery.v1', JSON.stringify({ cityId: 'beit-jann', kind: 'restaurant', locationEnabled: true }));
    navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 2, message: 'test', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  await page.goto('/');
  const alert = page.getByRole('status').filter({ hasText: 'We could not find your location.' });
  await expect(alert).toContainText('We could not find your location.');
  await alert.getByRole('button', { name: 'Change city', exact: true }).click();
  await page.getByRole('option', { name: 'Hurfeish', exact: true }).click();
  await expect(page.locator('.city-pill')).toContainText('Hurfeish');
});

test('a delayed location request cannot override a manual selection', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as unknown as { finishLocation: () => void }).finishLocation = () => success({ coords: { latitude: 32.9628, longitude: 35.3822, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await page.locator('.city-pill').click();
  await page.getByRole('option', { name: 'Hurfeish', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishLocation: () => void }).finishLocation());
  await expect(page.locator('.city-pill')).toContainText('Hurfeish');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('customer address uses a map pin and cancel does not change the form', async ({ page }) => {
  await signInAsCustomer(page);
  await page.goto('/account/addresses');
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Choose a location' });
  await map.locator('.location-map').click({ position: { x: 110, y: 100 } });
  await expect(map.getByRole('button', { name: 'Use this location' })).toBeEnabled();
  await map.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose on map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await map.getByRole('button', { name: 'Select the centre of the map', exact: true }).click();
  await map.getByRole('button', { name: 'Use this location', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change location on map', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('32.9628, 35.3822')).toHaveCount(0);
});

test('a map permission refusal explains how to place a pin manually', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: 'test', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  await signInAsCustomer(page);
  await page.goto('/account/addresses');
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  const map = page.getByRole('dialog', { name: 'Choose a location', exact: true });
  await map.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(map).toContainText('tap the map to choose a spot');
  await map.locator('.location-map').click({ position: { x: 110, y: 100 } });
  await map.getByRole('button', { name: 'Use this location', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change location on map', exact: true })).toBeVisible();
});
