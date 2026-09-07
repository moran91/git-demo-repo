import { expect, type Page } from '@playwright/test';

/**
 * Emulator-only helpers. No firebase-admin: the Auth emulator accepts unsigned (alg=none) custom
 * tokens, and the Firestore emulator REST API is queried with the "owner" bearer token.
 */
const PROJECT = 'qareeb-dev';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
export const PASSWORD = 'Qareeb-Test-1234';

function b64url(s: string) {
  return Buffer.from(s).toString('base64url');
}
export function mintCustomToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: 'firebase-auth-emulator@example.com', sub: 'firebase-auth-emulator@example.com', aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', uid, iat: now, exp: now + 3600 }));
  return `${header}.${payload}.`;
}

type FsValue = { stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; mapValue?: { fields?: Record<string, FsValue> }; arrayValue?: { values?: FsValue[] }; nullValue?: null };
function decode(v: FsValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decode);
  return null;
}
export async function fsQuery(collectionId: string, filters: Array<{ field: string; op: 'EQUAL'; value: string }>, limit = 10): Promise<Array<Record<string, unknown> & { id: string }>> {
  const structuredQuery = {
    from: [{ collectionId }],
    where: { compositeFilter: { op: 'AND', filters: filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: { stringValue: f.value } } })) } },
    limit,
  };
  const res = await fetch(`${FS}:runQuery`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
  const rows = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, FsValue> } }>;
  return rows.filter((r) => r.document).map((r) => ({ id: r.document!.name.split('/').pop()!, ...(decode({ mapValue: { fields: r.document!.fields } }) as Record<string, unknown>) }));
}
export async function fsGet(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) return null;
  const doc = (await res.json()) as { fields: Record<string, FsValue> };
  return decode({ mapValue: { fields: doc.fields } }) as Record<string, unknown>;
}

/** Signs the browser session in as a seeded phone customer via a custom token (emulator only). */
export async function signInAsCustomer(page: Page, uid = 'seed-customer1') {
  const token = mintCustomToken(uid);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __qareebSignIn?: unknown }).__qareebSignIn);
  await page.evaluate(async (tok) => {
    const w = window as unknown as { __qareebSignIn: (t: string) => Promise<void> };
    await w.__qareebSignIn(tok);
  }, token);
  await page.waitForTimeout(1000);
}

export async function setLocale(page: Page, locale: 'he' | 'ar' | 'en') {
  await page.addInitScript((l) => localStorage.setItem('qareeb.locale', l), locale);
}

export async function signInEmail(page: Page, email: string) {
  await page.goto('/business/signin');
  await page.getByLabel(/Email|אימייל|البريد/).fill(email);
  await page.getByLabel(/Password|סיסמה|كلمة المرور/).fill(PASSWORD);
  await page.getByRole('button', { name: /^(Sign in|כניסה|تسجيل الدخول)$/ }).click();
  await expect(page).toHaveURL(/\/business(\/(?!signin)|$)/);
}
