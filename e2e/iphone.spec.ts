import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const styles = ['tokens', 'base', 'extra'].map((name) =>
  readFileSync(new URL(`../apps/web/src/design/${name}.css`, import.meta.url), 'utf8'),
).join('\n');

for (const dir of ['ltr', 'rtl']) {
  test(`item sheet opens tall and every option remains reachable (${dir})`, async ({ page }) => {
    await page.setContent(`<html dir="${dir}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body>
      <div style="height:2000px">Menu</div><dialog class="dialog dialog--sheet dialog--expanded">
      <div class="dialog__grabber"></div><div class="dialog__header"><h2>Item options</h2><button>Close</button></div>
      <div class="dialog__body"><div class="stack">${Array.from({ length: 20 }, (_, i) => `<label class="choice"><input type="checkbox">Option ${i}</label>`).join('')}</div></div>
      <div class="dialog__footer"><button class="btn">Add to cart</button></div></dialog></body></html>`);
    await page.evaluate(() => { window.scrollTo(0, 700); document.querySelector('dialog')!.showModal(); });
    for (const height of [844, 600, 420, 844]) {
      await page.setViewportSize({ width: 390, height });
      const box = await page.locator('dialog').boundingBox();
      expect(box!.height).toBeGreaterThan(height * 0.85);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      await page.getByRole('checkbox').last().click();
      await expect(page.getByRole('checkbox').last()).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Add to cart' })).toBeInViewport();
      await page.getByRole('checkbox').first().click();
      await expect(page.getByRole('checkbox').first()).toBeInViewport();
    }
  });
}

// Exercise the real built app and Firebase SDK, stubbing only external services. No SMS is sent.
async function phonePage(page: Page, failures: string[] = [], widgetFailure = '', enterpriseMode?: 'AUDIT' | 'ENFORCE') {
  const requests: Array<{ phoneNumber?: string; recaptchaToken?: string; captchaResponse?: string; recaptchaVersion?: string }> = [];
  await page.addInitScript((widgetFailure) => {
    localStorage.setItem('qareeb.locale', 'en');
    const widgets: Array<{ callback: (token: string) => void; size: string; container: HTMLElement }> = [];
    Object.assign(window, { grecaptcha: {
      render(container: HTMLElement, params: { callback: (token: string) => void; size: string; 'error-callback': () => void; 'expired-callback': () => void }) {
        if (widgetFailure === 'render') throw new TypeError('Verification script failed');
        const id = widgets.length;
        widgets.push({ ...params, container });
        if (params.size !== 'invisible') {
          const button = document.createElement('button');
          button.textContent = 'Complete test security check';
          button.onclick = () => {
            if (widgetFailure === 'error') params['error-callback']();
            else if (widgetFailure === 'expired') params['expired-callback']();
            else params.callback('visible-test-token');
          };
          Object.assign(window, { finishOldChallenge: () => params.callback('late-token') });
          container.append(button);
        }
        return id;
      },
      getResponse: () => '',
      execute(id: number) { widgets[id]!.callback('invisible-test-token'); },
      reset: () => {},
    } });
  }, widgetFailure);
  await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path.endsWith('/recaptchaParams')) body = { recaptchaSiteKey: 'test-key' };
    else if (path.endsWith('/recaptchaConfig')) body = enterpriseMode
      ? { recaptchaKey: 'projects/test/keys/enterprise-test-key', recaptchaEnforcementState: [{ provider: 'PHONE_PROVIDER', enforcementState: enterpriseMode }] }
      : { recaptchaEnforcementState: [] };
    else if (path.endsWith('accounts:sendVerificationCode')) {
      requests.push(route.request().postDataJSON());
      const failure = failures.shift();
      if (failure) { status = 400; body = { error: { code: 400, message: failure } }; }
      else body = { sessionInfo: 'test-session' };
    } else if (path.endsWith('accounts:signInWithPhoneNumber')) {
      status = 400; body = { error: { code: 400, message: 'INVALID_CODE' } };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  if (enterpriseMode) {
    await page.route('https://www.google.com/recaptcha/enterprise.js*', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.grecaptcha.enterprise = { ready: callback => callback(), execute: async () => 'enterprise-test-token' }; window.onFirebaseAuthREInstanceReady();`,
    }));
  }
  await page.route('**/authOptions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { whatsapp: false } }) }));
  await page.goto('/signin');
  await page.locator('input[type="tel"]').fill('٠٥٠١٢٣٤٥٦٧');
  await page.getByRole('checkbox').check();
  return requests;
}

test('visible verification completes before the SMS request', async ({ page }) => {
  const requests = await phonePage(page);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByText('Complete the security check below')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  expect(requests.map((r) => r.phoneNumber)).toEqual(['+972501234567']);
  expect(requests[0]!.recaptchaToken).toBe('visible-test-token');
  await expect(page.locator('#recaptcha-container')).toBeEmpty();
  await page.getByLabel('Verification code').fill('١٢٣٤٥٦');
  await expect(page.getByLabel('Verification code')).toHaveValue('123456');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That code is not correct.');
});

test('numeric Firebase delivery errors preserve the provider code', async ({ page }) => {
  const requests = await phonePage(page, ['Error code: 39']);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('alert')).toContainText('sending/error-code:-39');
  await expect(page.getByRole('alert')).toContainText('SMS delivery is currently unavailable for this number. Please try again later.');
  await expect(page.getByRole('alert')).not.toContainText('FirebaseError');
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
});

for (const mode of ['AUDIT', 'ENFORCE'] as const) {
  test(`SMS Defense ${mode} sends the enterprise assessment token`, async ({ page }) => {
    const requests = await phonePage(page, [], '', mode);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await page.getByRole('button', { name: 'Complete test security check' }).click();
    await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ captchaResponse: 'enterprise-test-token', recaptchaVersion: 'RECAPTCHA_ENTERPRISE' });
  });
  test(`SMS Defense ${mode} respects the configured fallback policy`, async ({ page }) => {
    const requests = await phonePage(page, ['INVALID_APP_CREDENTIAL'], '', mode);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await page.getByRole('button', { name: 'Complete test security check' }).click();
    if (mode === 'AUDIT') {
      await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
      expect(requests).toHaveLength(2);
      expect(requests[1]?.recaptchaToken).toBe('visible-test-token');
    } else {
      await expect(page.getByRole('alert')).toContainText('sending/invalid-app-credential');
      expect(requests).toHaveLength(1);
      await expect(page.getByRole('heading', { name: 'Enter the code' })).not.toBeVisible();
    }
  });
}

test('resend and changing numbers keep a usable verification container', async ({ page }) => {
  const requests = await phonePage(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  await page.evaluate(() => { document.querySelector('#recaptcha-container')!.setAttribute('data-stable', 'yes'); });
  await page.clock.runFor(31_000);
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole('button', { name: 'Change number' }).click();
  await page.locator('input[type="tel"]').fill('0507654321');
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]!.phoneNumber).toBe('+972507654321');
  await expect(page.locator('#recaptcha-container')).toHaveAttribute('data-stable', 'yes');
});

for (const failure of ['TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED']) {
  test(`${failure} has an actionable message and is not retried automatically`, async ({ page }) => {
    const requests = await phonePage(page, [failure]);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await page.getByRole('button', { name: 'Complete test security check' }).click();
    await expect(page.getByRole('alert')).toContainText(failure === 'QUOTA_EXCEEDED' ? 'SMS sign-in is temporarily unavailable' : 'Too many');
    expect(requests).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await page.getByRole('button', { name: 'Complete test security check' }).click();
    await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  });
}

for (const failure of ['render', 'error', 'expired']) {
  test(`verification ${failure} failure releases the form without sending an SMS`, async ({ page }) => {
    const requests = await phonePage(page, [], failure);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    if (failure !== 'render') await page.getByRole('button', { name: 'Complete test security check' }).click();
    await expect(page.getByRole('alert')).toContainText(failure === 'expired' ? 'security check expired' : 'security check could not start');
    await expect(page.getByRole('alert')).toContainText('Error reference:');
    await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
    await expect(page.locator('#recaptcha-container')).toBeEmpty();
    expect(requests).toHaveLength(0);
  });
}

test('cancelling a challenge prevents a late callback from sending an SMS', async ({ page }) => {
  const requests = await phonePage(page);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete test security check' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel verification' }).click();
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { finishOldChallenge: () => void }).finishOldChallenge());
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await page.locator('input[type="tel"]').fill('0507654321');
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  expect(requests.map((r) => r.phoneNumber)).toEqual(['+972507654321']);
});

test('Safari storage restrictions do not block starting phone verification', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('firebase:')) throw new DOMException('Storage unavailable', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('firebase:')) throw new DOMException('Storage unavailable', 'SecurityError');
      return setItem.call(this, key, value);
    };
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } });
  });
  const requests = await phonePage(page);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a stalled security-check load times out and can be retried', async ({ page }) => {
  const requests = await phonePage(page);
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/recaptchaParams*', async (route) => {
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ recaptchaSiteKey: 'test-key' }) }).catch(() => undefined);
  }, { times: 1 });
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading the security check');
  await page.clock.fastForward(21_000);
  await expect(page.getByRole('alert')).toContainText('loading-check/verification-timeout');
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeEnabled();
  release();
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByRole('button', { name: 'Complete test security check' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  expect(requests).toHaveLength(1);
});
