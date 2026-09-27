# Admin access to every business — design

Date: 2026-09-26 · Status: awaiting review

## Goal

A platform admin can open any business's dashboard from the admin panel and do everything that business's owner can do: menu, orders, deals, stories, branch and business settings, staff, printers, cash, loyalty. Every change an admin makes inside a business is recorded in the audit log with the admin as the actor.

**Agreed with the user:** owner-level power (not view-only, not a subset), reached from the admin panel, audited.

**Assumption:** an admin acts as themselves. There is no "log in as the owner", and the owner's own access does not change.

## What already exists (verified in code)

| Layer | State |
|---|---|
| Server permission check | `requireMembership()` (`functions/src/lib/auth.ts:63`) returns `{ role: 'admin' }` for an admin, so all 46 business callables already accept admins. An admin needs the `admin` claim **and** `users/{uid}.isAdmin`. |
| Firestore rules | `isAdmin()` grants read on every business-scoped collection. All writes are `false` for everyone; writes go through callables. |
| Storage rules | `isAdmin()` is ORed into `isCatalogEditor` / `isOwnerOrManager`, so admins can upload branding and catalog, deal and post images. |
| Business panel | `DashboardShell` allows `isAdmin \|\| membership`; `ROLE_PERMS.admin` equals `owner`; admins load every branch of the business. |
| Guards that stay | An admin cannot be added as a member (`cannot_add_admin`) and cannot accept an invite (`admin_cannot_accept`). |

## Gaps this design closes

1. The UI has no way in: the admin panel never links to `/business/...`; `/business` and the business switcher list memberships only.
2. Nothing in the dashboard shows that an admin is acting inside someone else's business.
3. Most business changes write no audit row: updateBusiness, setBusinessImage, createBranch, updateBranch, setOrdersPaused, and most catalog callables.
4. `recordCash` and the printing `printed` event hard-code `actorRole: 'staff'`, so an admin's action is mislabelled.
5. No test has an admin calling a business callable.

## Design

### 1. Central audit of admin actions (server)

One hook, no per-callable edits.

- New `functions/src/lib/adminAudit.ts` (depends only on `lib/firebase`):
  - A module-level `WeakMap<request, AdminScope>`, where `AdminScope = { uid, businessId, branchId? }`.
  - `markAdminScope(req, scope)` records the scope.
  - `flushAdminAudit(req, ok)`: when `ok` and a scope exists, it writes one `audit/{id}` row:
    - `actorUid`: the admin's uid
    - `action`: `admin.<FUNCTION_TARGET>` (e.g. `admin.saveProduct`). `FUNCTION_TARGET` is set per function by Cloud Functions and by the emulator (`functionsEmulator.js getSystemEnvs`); it falls back to `admin.unknown`.
    - `targetType: 'business'`, `targetId: businessId`
    - `after`: `{ branchId?, ids, fields }`, where `ids` holds every input key ending in `Id` (string values only) and `fields` lists the top-level input keys. No payload values beyond ids, so no personal data or large blobs.
    - `at`: now
- `requireCaller(req)` keeps a reference from the caller context to its request, so `requireMembership` can call `markAdminScope` in its admin branch. It passes the business id and the branch id it was given. The existing order stays: the admin check comes first. Admins can't be members (`cannot_add_admin`), so there is no overlap to resolve.
- `handled()` (`lib/errors.ts`) calls `flushAdminAudit(req, true)` after `fn(req)` resolves, and nothing when it throws. Only successful changes are logged.
- An audit write failure is logged with `console.error` and does **not** fail the call, because the action has already committed.
- Read-only or noise callables are skipped via a small constant set: `listMembers` (read) and `stationHeartbeat` (periodic ping).
- Callables that already write their own audit row (e.g. `setLoyaltyRules`, `saveCombo`) also get the `admin.*` row. The duplication is accepted: one row describes the change, the other marks it as an admin action.

### 2. Correct actor roles (server)

- `recordCash` (`orders.ts:723`) stores the role returned by `loadOrderForStaff` instead of `'staff'`.
- The printing `printed` order event (`printing.ts:218`) stores the caller's role from `requireMembership`.

### 3. Getting in (admin panel)

- `Businesses` list: each row gets an "Open dashboard" link to `/business/{businessId}`. The shell already redirects to the first branch.
- `BusinessDetail` title row: the same link, as a secondary button.

### 4. Business panel for admins

- **Admin banner:** when `role === 'admin'` (admin with no membership in this business), a slim bar sits at the top of the main area on every page: "Admin mode · «Business name»" plus a "Back to admin" link to `/admin/businesses/{id}`. It uses the accent tone, is not dismissible, and has no extra explanatory copy.
- **Business switcher:** for admins it lists every business (`businesses` collection, ordered by name, limit 500), plus their memberships, each business once. With more than 8 entries, a search field filters by name.
- **`/business` index:** an admin with no membership sees the same searchable list of all businesses instead of the current "no business" state.
- New i18n keys in he/en/ar: `admin.openDashboard`, `admin.modeBanner`, `admin.backToAdmin`, `admin.searchBusinesses`, `admin.allBusinesses`.

### 5. Rules

No change. Admins already have read access, and writes stay server-only.

## Testing

- **Functions** (`functions/test/admin-business-access.test.ts`):
  - An admin calls `saveCategory`, `setOrdersPaused` and `decideOrder` on a business they don't belong to (`decideOrder` rather than `updateBranch`: the cash test below needs an accepted order anyway, and `updateBranch` needs a full branch payload). Each succeeds, and each writes exactly one `admin.<name>` audit row with the admin's uid and the business id.
  - A failing admin call (invalid input) writes no audit row.
  - An owner calling on their own business writes no `admin.*` row.
  - A non-admin, non-member is still refused (`forbidden`).
  - `listMembers` by an admin writes no row.
  - `recordCash` by an admin stores `actorRole: 'admin'`.
- **Rules** (`tests/rules/firestore.test.ts`): an admin can read `businesses/{b}`, a branch, a product and `cashRecords`; an admin write to a product is still denied.
- **E2E** (`e2e/admin-business-access.spec.ts`): the admin opens a business from `/admin/businesses`, sees the banner, pauses orders or renames a category, and the change shows up in the admin audit page. The spec cleans up after itself (resumes orders, restores the name).
- Regression: the existing functions, rules and e2e suites.

## Out of scope

- A "view as a specific staff role" mode.
- Changes to owner, manager or staff permissions.
- Admin membership records or invitations.
- Moving the existing per-callable audit rows into the central hook.

## Risks

- `FUNCTION_TARGET` missing in some future runtime: the action becomes `admin.unknown`, but the row is still written with actor, business and ids.
- Audit volume: one extra row per admin change. That's negligible at current scale.
- The admin switcher reads up to 500 businesses once per session. That's acceptable now; paginate later if the platform grows.
