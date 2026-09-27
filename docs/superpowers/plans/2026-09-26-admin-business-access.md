# Admin Access to Every Business — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform admin can open any business's dashboard from the admin panel, act with owner-level power, and every successful change they make there is audited.

**Architecture:** The server already lets admins through `requireMembership`. We add one central hook: `requireMembership` marks the request when an admin passes, and the shared callable wrapper `handled()` writes one `admin.<callable>` audit row after the action succeeds. The web app adds "Open dashboard" links in the admin panel, an admin-mode banner in the business panel, and all-business lists for admins (switcher and `/business`).

**Tech Stack:** Firebase Functions v2 (TypeScript, callables), Firestore rules, React 19 + react-router, Vitest (functions and rules tests against emulators), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-26-admin-business-access-design.md`

## Global Constraints

- Audit action names are exactly `admin.<FUNCTION_TARGET>`, falling back to `admin.unknown`; `targetType: 'business'`; `targetId` is the business id.
- Audit `after` holds only `{ branchId?, ids, fields }`: input keys ending in `Id` (string values), one level of `<key>.id`, and the list of top-level input keys. No other input values.
- Skipped callables: `listMembers` and `stationHeartbeat`.
- A failed audit write never fails the callable (`console.error` only). Failed callables write no admin row.
- No Firestore or Storage rules change.
- UI copy is minimal and never restates a label (user rule). New i18n keys go into he, en and ar together: `admin.openDashboard`, `admin.modeBanner`, `admin.backToAdmin`, `admin.searchBusinesses`, `admin.allBusinesses`.
- **Git:** the tree is dirty with uncommitted work. Never `git checkout`, `git restore` or `git stash`. Don't commit unless the user asks, so this plan has no commit steps.
- **Environment:** emulators on 127.0.0.1 (Firestore 8080, Auth 9099, Functions 5001, Storage 9199) and vite on 127.0.0.1:5173 are already running. Clear `HTTPS_PROXY`/`https_proxy` for every emulator, test and seed command. The functions emulator serves the compiled `functions/lib`, so run `npm run build -w functions` before functions tests. Functions tests wipe and reseed the emulator (`test/global-setup.ts`).
- Playwright runs from `e2e/` with `PLAYWRIGHT_CHROMIUM_PATH="$(ls -d ~/Library/Caches/ms-playwright/chromium-1243/chrome-mac*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing)"`.

## Review Focus

1. **A real owner never sees the admin banner** in their own business, even when the owner account is also an admin elsewhere. Pinned in Task 5 (e2e).
2. **Admin opening a pending (unapproved) business** gets a working dashboard, not "forbidden". Pinned in Task 5 (e2e).
3. **A failed admin call (bad input)** leaves no admin audit row. Pinned in Task 1.
4. **Admin reads everything but still cannot write directly** to Firestore. Pinned in Task 3.
5. **The admin switcher lists businesses the admin is not a member of.** Pinned in Task 5 (e2e).

---

### Task 1: Central admin audit hook (server)

**Files:**
- Create: `functions/src/lib/adminAudit.ts`
- Modify: `functions/src/lib/auth.ts` (`requireCaller`, `requireMembership`)
- Modify: `functions/src/lib/errors.ts` (`handled`, lines 58-70)
- Test: `functions/test/admin-business-access.test.ts`

**Interfaces:**
- Produces: `bindCaller(caller: object, req: CallableRequest<unknown>): void`, `markAdminScope(caller: object, scope: { uid: string; businessId: string; branchId?: string }): void`, `flushAdminAudit(req: object): Promise<void>`, `summarizeInput(data: unknown): { ids: Record<string, string>; fields: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `functions/test/admin-business-access.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, deliveryBase, expectCode, IDS, key, shawarmaLine, USERS, type Client } from './harness.js';

let adminC: Client;
let owner1: Client;
let owner2: Client;
let customer2: Client;
let adminUid: string;
let owner1Uid: string;

beforeAll(async () => {
  [adminC, owner1, owner2, customer2] = await Promise.all([asEmail(USERS.admin), asEmail(USERS.owner1), asEmail(USERS.owner2), asUid(USERS.customer2)]);
  adminUid = (await admin.auth.getUserByEmail(USERS.admin)).uid;
  owner1Uid = (await admin.auth.getUserByEmail(USERS.owner1)).uid;
});
afterAll(async () => {
  await Promise.all([adminC, owner1, owner2, customer2].map((c) => c.close()));
});

const base = { businessId: IDS.restaurant, branchId: IDS.branchA };

async function rowsSince(since: string, filter: (row: FirebaseFirestore.DocumentData) => boolean) {
  const q = await admin.db.collection('audit').where('at', '>=', since).get();
  return q.docs.map((d) => d.data()).filter(filter);
}

describe('platform admin acting inside a business', () => {
  it('runs business callables without a membership; each success writes one admin audit row', async () => {
    const since = new Date().toISOString();
    await adminC.call('saveCategory', { ...base, category: { name: { he: 'בדיקת מנהל' } } });
    await adminC.call('setOrdersPaused', { ...base, paused: true });
    await adminC.call('setOrdersPaused', { ...base, paused: false });
    const cat = await rowsSince(since, (r) => r.action === 'admin.saveCategory');
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ actorUid: adminUid, targetType: 'business', targetId: IDS.restaurant, after: { branchId: IDS.branchA, ids: { businessId: IDS.restaurant, branchId: IDS.branchA } } });
    expect(cat[0]!.after.fields).toEqual(['businessId', 'branchId', 'category']);
    expect(JSON.stringify(cat[0]!.after)).not.toContain('בדיקת מנהל');
    expect(await rowsSince(since, (r) => r.action === 'admin.setOrdersPaused')).toHaveLength(2);
  });

  it('writes no admin row when the admin call fails', async () => {
    const since = new Date().toISOString();
    expect(await expectCode(adminC.call('saveCategory', { ...base, category: { name: {} } }))).toBe('invalid_argument');
    expect(await rowsSince(since, (r) => String(r.action).startsWith('admin.'))).toHaveLength(0);
  });

  it('writes no admin row for members, skips read-only listMembers, and still refuses non-members', async () => {
    const since = new Date().toISOString();
    await owner1.call('saveCategory', { ...base, category: { name: { he: 'בדיקת בעלים' } } });
    await adminC.call('listMembers', { businessId: IDS.restaurant });
    expect(await expectCode(owner2.call('saveCategory', { ...base, category: { name: { he: 'x' } } }))).toBe('forbidden');
    const adminRows = await rowsSince(since, (r) => String(r.action).startsWith('admin.'));
    expect(adminRows.filter((r) => r.actorUid === owner1Uid)).toHaveLength(0);
    expect(adminRows.filter((r) => r.action === 'admin.listMembers')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
cd functions && env -u HTTPS_PROXY -u https_proxy npm run build && env -u HTTPS_PROXY -u https_proxy npx vitest run test/admin-business-access.test.ts
```
Expected: the first test FAILS with `expected [] to have length 1` (no audit rows yet). The non-member refusal already passes.

- [ ] **Step 3: Create `functions/src/lib/adminAudit.ts`**

```ts
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { AuditEvent } from '@qareeb/shared';
import { col, nowIso } from './firebase.js';

/**
 * Central audit for platform admins acting inside a business. `requireMembership` marks the request
 * when an admin passes it; `handled()` flushes one `admin.<callable>` row after the callable resolves.
 * Only ids and field names are stored, never input values.
 */
export interface AdminScope { uid: string; businessId: string; branchId?: string }

const requestOf = new WeakMap<object, CallableRequest<unknown>>();
const scopes = new WeakMap<object, AdminScope>();
/** Read-only or periodic callables: auditing them would only add noise. */
const SKIP = new Set(['listMembers', 'stationHeartbeat']);

export function bindCaller(caller: object, req: CallableRequest<unknown>): void {
  requestOf.set(caller, req);
}

export function markAdminScope(caller: object, scope: AdminScope): void {
  const req = requestOf.get(caller);
  if (req) scopes.set(req, scope);
}

export function summarizeInput(data: unknown): { ids: Record<string, string>; fields: string[] } {
  const ids: Record<string, string> = {};
  const fields: string[] = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      fields.push(k);
      if (typeof v === 'string' && k.endsWith('Id')) ids[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { id?: unknown }).id === 'string') ids[`${k}.id`] = (v as { id: string }).id;
    }
  }
  return { ids, fields };
}

export async function flushAdminAudit(req: object): Promise<void> {
  const scope = scopes.get(req);
  if (!scope) return;
  scopes.delete(req);
  const name = process.env.FUNCTION_TARGET || 'unknown';
  if (SKIP.has(name)) return;
  try {
    const ref = col.audit().doc();
    const { ids, fields } = summarizeInput((req as CallableRequest<unknown>).data);
    const after = { ...(scope.branchId ? { branchId: scope.branchId } : {}), ids, fields };
    await ref.set({ id: ref.id, actorUid: scope.uid, action: `admin.${name}`, targetType: 'business', targetId: scope.businessId, after, at: nowIso() } satisfies AuditEvent);
  } catch (e) {
    // The callable already committed; a missing audit row must not turn a success into an error.
    console.error('admin audit write failed', e instanceof Error ? e.message : e);
  }
}
```

- [ ] **Step 4: Wire `auth.ts`**

In `functions/src/lib/auth.ts`, add the import after line 4:

```ts
import { bindCaller, markAdminScope } from './adminAudit.js';
```

Replace the last line of `requireCaller`:

```ts
  return { uid: req.auth.uid, token: req.auth.token as Caller['token'], profile, isAdmin };
```

with:

```ts
  const caller: Caller = { uid: req.auth.uid, token: req.auth.token as Caller['token'], profile, isAdmin };
  bindCaller(caller, req);
  return caller;
```

Replace the admin line in `requireMembership`:

```ts
  if (c.isAdmin) return { role: 'admin', membership: null };
```

with:

```ts
  if (c.isAdmin) {
    markAdminScope(c, { uid: c.uid, businessId, branchId });
    return { role: 'admin', membership: null };
  }
```

- [ ] **Step 5: Wire `handled()` in `errors.ts`**

Add the import at the top of `functions/src/lib/errors.ts`:

```ts
import { flushAdminAudit } from './adminAudit.js';
```

Replace `return await fn(req);` inside `handled` with:

```ts
      const result = await fn(req);
      await flushAdminAudit(req as unknown as object);
      return result;
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: the same command as Step 2.
Expected: 3 passed. If the first test shows `admin.unknown` instead of `admin.saveCategory`, the emulator isn't setting `FUNCTION_TARGET` per function. In that case stop and report; don't hard-code names.

---

### Task 2: Record the caller's real role on cash and print events (server)

**Files:**
- Modify: `functions/src/domain/orders.ts` (`loadOrderForStaff` ~line 420, `recordCash` ~line 684 and the `cash_recorded` event ~line 723)
- Modify: `functions/src/domain/printing.ts` (`enqueuePrint`: the `requireMembership` call ~line 190 and the `printed` event ~line 218)
- Test: `functions/test/admin-business-access.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's audit rows (`admin.decideOrder`, `admin.recordCash`).
- Produces: `loadOrderForStaff(...)` returns `{ order: Order; role: MembershipRole | 'admin' }`.

- [ ] **Step 1: Append the failing test**

Add inside the `describe` in `functions/test/admin-business-access.test.ts`:

```ts
  it('admin accepts an order and records cash; events carry actorRole admin and both actions are audited', async () => {
    const since = new Date().toISOString();
    const { orderId } = await customer2.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    await adminC.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    const order = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    await adminC.call('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version, idempotencyKey: key() });
    const events = (await admin.db.collection('orders').doc(orderId).collection('events').get()).docs.map((d) => d.data());
    expect(events.find((e) => e.type === 'cash_recorded')!.actorRole).toBe('admin');
    const actions = (await rowsSince(since, (r) => r.targetId === IDS.restaurant)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.decideOrder', 'admin.recordCash']));
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd functions && env -u HTTPS_PROXY -u https_proxy npx vitest run test/admin-business-access.test.ts -t "records cash"`
Expected: FAIL, `expected 'staff' to be 'admin'`.

- [ ] **Step 3: Implement**

In `orders.ts`, change the `loadOrderForStaff` signature return type from `Promise<{ order: Order; role: string }>` to `Promise<{ order: Order; role: MembershipRole | 'admin' }>`. Add `MembershipRole` to the existing `@qareeb/shared` type import if it isn't there.

In `recordCash`, change `const { order } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);` to:

```ts
    const { order, role } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);
```

In the `cash_recorded` event, replace `actorRole: 'staff'` with `actorRole: role`.

In `printing.ts` `enqueuePrint`, change `await requireMembership(c, printer.businessId, ['owner', 'manager', 'staff'], printer.branchId, tx);` to:

```ts
    const { role } = await requireMembership(c, printer.businessId, ['owner', 'manager', 'staff'], printer.branchId, tx);
```

In the `printed` event object, replace `actorRole: 'staff' as const` with `actorRole: role`.

- [ ] **Step 4: Build and run the whole file**

Run: `cd functions && env -u HTTPS_PROXY -u https_proxy npm run build && env -u HTTPS_PROXY -u https_proxy npx vitest run test/admin-business-access.test.ts`
Expected: 4 passed. `npm run typecheck -w functions` is clean.

---

### Task 3: Rules tests for admin reads (no rules change)

**Files:**
- Test: `tests/rules/firestore.test.ts` (add one `it` next to the existing admin test, ~line 123)

- [ ] **Step 1: Add the test**

```ts
  it('platform admin reads every business-scoped document but cannot write directly', async () => {
    const a = as('admin', { admin: true });
    await assertSucceeds(getDoc(doc(a, 'businesses/biz1')));
    await assertSucceeds(getDoc(doc(a, 'businesses/biz1/branches/brA')));
    await assertSucceeds(getDoc(doc(a, 'businesses/biz1/branches/brA/products/p1')));
    await assertSucceeds(getDoc(doc(a, 'memberships/owner1_biz1')));
    await assertSucceeds(getDoc(doc(a, 'cashRecords/c1')));
    await assertFails(setDoc(doc(a, 'businesses/biz1/branches/brA/products/p1'), { name: 'x' }));
    await assertFails(updateDoc(doc(a, 'businesses/biz1'), { approval: 'approved' }));
  });
```

- [ ] **Step 2: Run the rules suite**

Run: `env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules`
Expected: all pass. The existing rules already grant this, so a failure means the rules differ from the spec; stop and report, don't edit the rules.

---

### Task 4: "Open dashboard" in the admin panel + i18n keys

**Files:**
- Modify: `apps/web/src/admin/AdminRoutes.tsx` (`Businesses` ~line 132 and `BusinessDetail` title row ~line 169)
- Modify: `packages/shared/src/i18n/he.ts`, `en.ts`, `ar.ts` (append keys before the closing `};`, or `} as const;` in en.ts)

**Interfaces:**
- Produces: i18n keys `admin.openDashboard`, `admin.modeBanner` (param `{name}`), `admin.backToAdmin`, `admin.searchBusinesses`, `admin.allBusinesses`.

- [ ] **Step 1: Add the keys**

he.ts:
```ts
  'admin.openDashboard': 'פתיחת לוח הבקרה',
  'admin.modeBanner': 'מצב מנהל · {name}',
  'admin.backToAdmin': 'חזרה לניהול',
  'admin.searchBusinesses': 'חיפוש עסק',
  'admin.allBusinesses': 'כל העסקים',
```
en.ts:
```ts
  'admin.openDashboard': 'Open dashboard',
  'admin.modeBanner': 'Admin mode · {name}',
  'admin.backToAdmin': 'Back to admin',
  'admin.searchBusinesses': 'Search businesses',
  'admin.allBusinesses': 'All businesses',
```
ar.ts:
```ts
  'admin.openDashboard': 'فتح لوحة التحكم',
  'admin.modeBanner': 'وضع المسؤول · {name}',
  'admin.backToAdmin': 'العودة للإدارة',
  'admin.searchBusinesses': 'البحث عن محل',
  'admin.allBusinesses': 'كل المحلات',
```

- [ ] **Step 2: Add the links**

In `Businesses`, add an empty header cell `<th></th>` at the end of the header row. At the end of each body row add:

```tsx
<td><Link className="btn btn--secondary btn--sm" to={`/business/${b.id}`}>{t('admin.openDashboard')}</Link></td>
```

In `BusinessDetail`, change the title row to:

```tsx
<div className="dash__title"><h1>{name}</h1><Badge tone={b.approval === 'approved' ? 'success' : b.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${b.approval}`)}</Badge><div className="actions"><Link className="btn btn--secondary" to={`/business/${b.id}`}>{t('admin.openDashboard')}</Link></div></div>
```

- [ ] **Step 3: Check**

Run: `npm run build -w packages/shared && npm run typecheck -w apps/web && npm run test -w packages/shared`
Expected: clean, and the shared tests pass (they cover i18n key parity).

---

### Task 5: Admin mode in the business panel + e2e

**Files:**
- Modify: `apps/web/src/business/shell.tsx` (`DashboardShell` main area ~line 168, `SidebarFoot` ~line 207, `BusinessSwitcher` ~line 318)
- Modify: `apps/web/src/business/MorePage.tsx` (switcher section ~line 51)
- Modify: `apps/web/src/business/BusinessHome.tsx`
- Modify: `apps/web/src/business/business.css` (banner styles)
- Test: `e2e/admin-business-access.spec.ts`

**Interfaces:**
- Consumes: Task 4's i18n keys; `/business/{id}` links.
- Produces: `useSwitchableBusinesses(): { businesses: Business[]; loading: boolean }` exported from `shell.tsx`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/admin-business-access.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from `e2e/`): `env -u HTTPS_PROXY -u https_proxy PLAYWRIGHT_CHROMIUM_PATH="$CP" npx playwright test admin-business-access.spec.ts --trace=off --reporter=line`
Expected: the first two tests FAIL at the `Admin mode · …` banner assertion (Task 4 already added the link). The owner test passes.

- [ ] **Step 3: Banner in `DashboardShell`**

Add near the other small components in `shell.tsx`:

```tsx
/** Shown on every dashboard page while a platform admin works inside a business they do not belong to. */
function AdminModeBanner({ name, businessId }: { name: string; businessId: string }) {
  const t = useT();
  return (
    <div className="alert alert--warn dash__admin" role="status">
      <Icon name="shield" size={18} />
      <span className="dash__admin-text">{t('admin.modeBanner', { name })}</span>
      <Link to={`/admin/businesses/${businessId}`}>{t('admin.backToAdmin')}</Link>
    </div>
  );
}
```

In `DashboardShell`'s `<main>`, directly after `<OfflineBanner />`:

```tsx
          {role === 'admin' ? <AdminModeBanner name={L(business.data.name, business.data.defaultLocale)} businessId={business.data.id} /> : null}
```

Append to `business.css`:

```css
/* Admin acting inside someone else's business: a persistent, non-dismissible marker above every page. */
.business-app .alert.dash__admin { align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); }
.business-app .dash__admin-text { flex: 1 1 auto; min-width: 0; font-weight: 600; }
.business-app .dash__admin a { flex: none; display: inline-flex; align-items: center; min-height: var(--touch-min); font-weight: 600; }
```

- [ ] **Step 4: Switcher lists every business for admins**

Replace `BusinessSwitcher` in `shell.tsx` with:

```tsx
/** Businesses the caller can switch between: every business for a platform admin, otherwise their memberships. */
export function useSwitchableBusinesses(): { businesses: Business[]; loading: boolean } {
  const { L } = useI18n();
  const { memberships, isAdmin } = useAuth();
  const ids = memberships.map((m) => m.businessId);
  const mine = useCollection<Business>(!isAdmin && ids.length ? 'businesses' : null, [where('__name__', 'in', ids.slice(0, 10)), limit(10)], [ids.join(',')]);
  const all = useCollection<Business>(isAdmin ? 'businesses' : null, [limit(500)], [isAdmin]);
  const list = isAdmin ? all : mine;
  const businesses = useMemo(() => [...list.data].sort((a, b) => L(a.name, a.defaultLocale).localeCompare(L(b.name, b.defaultLocale))), [list.data, L]);
  return { businesses, loading: list.loading };
}

/** Select between businesses (renders nothing when there is only one). Long lists get a name filter. */
export function BusinessSwitcher({ currentBusinessId }: { currentBusinessId: string }) {
  const t = useT();
  const { L } = useI18n();
  const navigate = useNavigate();
  const { businesses } = useSwitchableBusinesses();
  const [q, setQ] = useState('');
  if (businesses.length <= 1) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? businesses.filter((b) => b.id === currentBusinessId || L(b.name, b.defaultLocale).toLowerCase().includes(needle)) : businesses;
  return (
    <div className="stack stack--sm">
      {businesses.length > 8 ? <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchBusinesses')} aria-label={t('admin.searchBusinesses')} /> : null}
      <select className="select" value={currentBusinessId} aria-label={t('dash.switchBusiness')} onChange={(e) => { navigate(`/business/${e.target.value}`); }}>
        {shown.map((b) => <option key={b.id} value={b.id}>{L(b.name, b.defaultLocale)}</option>)}
      </select>
    </div>
  );
}
```

Add `useMemo` to the `react` import in `shell.tsx` if it isn't there. In `SidebarFoot`, replace `{memberships.length > 1 ? <BusinessSwitcher currentBusinessId={business.id} /> : null}` with `<BusinessSwitcher currentBusinessId={business.id} />`. If `memberships` is then unused in `SidebarFoot`, drop it from the destructuring.

In `MorePage.tsx`, import `useSwitchableBusinesses` from `./shell`, call `const { businesses: switchable } = useSwitchableBusinesses();` in the component, and change the section condition from `memberships.length > 1` to `switchable.length > 1`.

- [ ] **Step 5: `/business` lists every business for an admin without memberships**

In `BusinessHome.tsx`:
- Import `useState`.
- Import `useSwitchableBusinesses` from `./shell`.
- Replace the `businesses` query with `const { businesses: list, loading: listLoading } = useSwitchableBusinesses();`.
- Use `listLoading` instead of `businesses.loading` and drop the `businesses.error` check (the hook surfaces no error; the membership error check stays).

Then replace the `memberships.length === 0 ? (...) : (...)` block with:

```tsx
      {isAdmin && memberships.length === 0 ? (
        <section className="stack" aria-label={t('admin.allBusinesses')}>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchBusinesses')} aria-label={t('admin.searchBusinesses')} />
          <BusinessGrid businesses={list.filter((b) => L(b.name, b.defaultLocale).toLowerCase().includes(q.trim().toLowerCase()))} />
        </section>
      ) : memberships.length === 0 ? (
        <EmptyState icon="store" title={t('dash.noBusiness')} action={<div className="home__actions"><Link className="btn btn--primary" to="/business/new">{t('dash.createBusiness')}</Link><Link className="btn btn--ghost" to="/">{t('common.goHome')}</Link></div>} />
      ) : (
        <BusinessGrid businesses={list} />
      )}
```

Declare `const [q, setQ] = useState('');` with the other hooks, before any early return. Move the existing `<ul className="grid-cards">…</ul>` markup unchanged into a component in the same file:

```tsx
function BusinessGrid({ businesses }: { businesses: Business[] }) {
  const t = useT();
  const { L } = useI18n();
  return (
    <ul className="grid-cards">
      {businesses.map((b) => (
        <li key={b.id}>
          <Link to={`/business/${b.id}`} className="card card--interactive home__card">
            <span className="dash__identity-mark" aria-hidden="true">{L(b.name, b.defaultLocale).trim().charAt(0)}</span>
            <span className="home__card-text">
              <strong className="truncate">{L(b.name, b.defaultLocale)}</strong>
              <span className="muted">{b.type === 'restaurant' ? t('common.restaurant') : t('common.supermarket')}</span>
              <Badge tone={b.approval === 'approved' ? 'success' : b.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${b.approval}`)}</Badge>
            </span>
            <Icon name="chevron" size={20} directional className="icon icon--dir home__card-chev" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

In the `home__actions` row at the bottom, keep a way back to the admin panel: add `{isAdmin ? <Link className="btn btn--secondary" to="/admin">{t('nav.admin')}</Link> : null}` before the sign-out button. Remove imports that become unused (`useCollection`, `where`, `limit`) so lint stays clean.

- [ ] **Step 6: Run the e2e and the checks**

Run from the repo root: `npm run typecheck -w apps/web && npx eslint apps/web/src`, then the Step 2 command.
Expected: typecheck clean, 0 lint errors, 3 passed.

---

### Task 6: Full verification and deploy

- [ ] **Step 1: Static checks**

Run: `npm run typecheck && npm run lint && npm run test -w packages/shared`
Expected: no TS errors, 0 lint errors, shared tests pass.

- [ ] **Step 2: Functions and rules suites**

Run: `env -u HTTPS_PROXY -u https_proxy npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules`
Expected: all pass. A `rate_limited` failure in `orders.test` is a known ordering issue (it passes alone); re-run that file alone before judging.

- [ ] **Step 3: Reseed, then run e2e**

Functions tests change memberships, so reseed before e2e:
```bash
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/qareeb-dev/databases/(default)/documents" -o /dev/null
curl -s -X DELETE "http://127.0.0.1:9099/emulator/v1/projects/qareeb-dev/accounts" -o /dev/null
cd scripts && env -u HTTPS_PROXY -u https_proxy SEED_ALWAYS_OPEN=1 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=qareeb-dev node --experimental-strip-types src/seed.ts
```
Then from `e2e/`: `npx playwright test admin-business-access.spec.ts customer.spec.ts z-business.spec.ts owner-usability.spec.ts stories.spec.ts --trace=off --reporter=line`
Expected: pass. The only known non-regression is `map selection…` when the emulator's `updateBranch` exceeds 15s; confirm by running it alone.

- [ ] **Step 4: Deploy**

1. Deploy functions with the `firebase_deploy` MCP tool (`only: 'functions'`, project `qareeb-dev`), then poll `firebase_deploy_status` until done.
2. Build the web app with `apps/web/.env.local` moved aside, and restore it afterwards.
3. Run `firebase deploy --only hosting --project qareeb-dev --non-interactive`.
4. Confirm the live `assets/index-*.js` hash matches `apps/web/dist/assets`.
5. If the classifier blocks a deploy, hand the exact command to the user.
