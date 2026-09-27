# Admin panel audit — 2026-09-27

Browser audit of every `/admin` screen on the emulator (seed + 6 orders, cash, suspend/reinstate), at 1280 and 390, in he / ar / en, plus a read of `AdminRoutes.tsx`, `functions/src/domain/admin.ts` and the rules/indexes behind them.

## Bugs

- [x] **Owner invitations never reach anyone in production.** `inviteOwner` returns the link only under `FUNCTIONS_EMULATOR`, and nothing sends email (the "transactional email" in the comment does not exist). Same for `inviteMember`. The page copy even says "Sends an email invitation". → Return the link to the inviter, show copy + WhatsApp share, fix the copy.
- [x] `setUserSuspended` clears `suspendedReason` with `undefined` → no-op under `ignoreUndefinedProperties`; a reinstated user keeps the old reason. → `FieldValue.delete()`.
- [x] `adminListUsers` returns `nextCursor` even when the page is short → "Load more" always shows and loads nothing.
- [x] Users search silently ignores anything that is not `…@…` or `+…`: typing `050-111-1111` or a name lists recent users as if it matched. → Normalise local phones server-side, add name-prefix search, empty state.
- [x] Orders list and inspect show "Accepted" for orders that are preparing/ready/completed (`OrderStatusBadge` gets no `stage`/`mode`).
- [x] After a cash reversal the order still shows "Cash received" and the reverse form (the next submit fails `already_reversed`) — `cashReversedAt` is ignored.
- [x] Orders list is not refreshed after reversing cash (one-shot `usePaged`).
- [x] "Orders waiting > 30 min" tab lists every placed order, including ones placed a minute ago.
- [x] Mobile drawer: no close button and Escape does not close it (the business panel's `<dialog>` drawer does both).
- [x] Suspend dialog has no busy state → double submit.
- [x] Loyalty dialog asks for a raw business **id** in a text field and pre-fills it from the user's *memberships* (customers have none).
- [x] Invite with "create business" hardcodes `defaultLocale: 'he'` even when only an Arabic name is entered.
- [x] Admin 404 "Go to home" leaves the panel (`/`).

## Wrong or missing copy

- [x] Hardcoded English in every locale: `Subscriptions: … · Commission: 0% · Paid promotion: …` (settings), `ID` column and `Sort` label (cities).
- [x] Settings line reads "WhatsApp OTP: Configured server-side: Disabled"; the monetization line repeats the alert above it.
- [x] Raw enums: `pickup` in order inspect, `business`/`branch` in the approval dialog ("Entity: business") and approval history.
- [x] Developer jargon in order inspect: `v3 · rev 0`.
- [x] Orders column header "Businesses" (plural) for one business.
- [x] "Businesses" metric counts only approved businesses.
- [x] Cities table header is the form hint "Search aliases (comma separated)".
- [x] Invite page hint promises an email that is never sent.

## Ids instead of people

- [x] Approvals: owner shown as `seed-own` (uid slice).
- [x] Business detail: owner uid, member uids, member branch **ids**, history actor uid + raw branch id.
- [x] Audit: actor uid (sliced), target as `user/seed-customer2` with no link.

## Layout / consistency

- [x] Admin shell predates the business panel: no skip link, inline `<style>` for the menu button, language segment + sign-out stacked and flush to the sidebar edge instead of the compact footer row.
- [x] No counts in the nav (pending approvals, orders waiting).
- [x] Users table: two stacked action buttons per row make every row ~110px; phone cards are ~370px each with empty rows.
- [x] Cities name cell mixes three scripts in one run; "Active" as Yes/No text.
- [x] Business detail "Approvals" card holds a lone Suspend button and an unlabeled reason.
- [x] Invite page has no nav highlight.
- [x] Dead code: `void collectionGroup; void ConfirmDialog;`, a visually-hidden date in Users, dynamic `import('firebase/firestore')` next to a static import.

## Big picture — what the panel should also have

- [x] **Nav groups + counts**: Operations (Overview, Approvals, Orders) · Accounts (Businesses, Users, Invitations) · Platform (Cities, Audit log, Settings).
- [x] **Overview trend**: 30-day orders chart with zero days filled; tiles link to their lists; accepted count and acceptance rate.
- [x] **User detail page** (`/admin/users/:uid`): profile, suspension reason, memberships → businesses, loyalty balances, recent orders, audit trail; suspend / adjust points live here.
- [x] **Business detail**: owner card (name, email, phone → user page), branches with open/paused state and per-branch dashboard link, members by name, recent orders, admin activity.
- [x] **Businesses list**: search + status filter.
- [x] **Orders**: reference search, age badge on waiting orders, inspect shows timeline (events), placed time, decision reason, customer → user page, business → detail.
- [x] **Audit**: filter by target type, actor names, target links, expandable before/after.
- [x] **Owner invitations page**: pending / accepted / expired, copy a fresh link, revoke.

## Found while fixing

- [x] `metricsDaily` was keyed by the UTC day, so orders between 00:00 and 03:00 Israel time counted toward the previous day. Now keyed by `toLocal().date`. (Days before 2026-09-27 stay UTC-keyed.)
- [x] An admin-created business kept `ownerUid: ''` after its owner accepted. `acceptInvitation` now sets it.
- [x] On phones, branch and order rows squeezed the name into a one-word column beside their badges. Rows now wrap instead.
- [x] In RTL, reasons and dates inside key–value rows lined up with the wrong edge (`dir="auto"` / bare `<bdi>` grid items).

## Verification (2026-09-27)

typecheck exit 0 · lint 0 errors · shared 124/124 · rules 19/19 · new `admin-panel.test.ts` 5/5 (red-green checked on the suspension fix) · full functions run 66/68: `combos` hit the known `rate_limited` ordering problem and `shared-extras` failed once under load; both passed when run alone · e2e 73/75: `review.spec` drag reorder fails on the old code too; the owner photo test timed out under load and passed alone · new `e2e/admin-panel.spec.ts` 5/5.
Deployed: all functions (+ `adminListInvitations`, `adminInvitationAction`) and hosting. Live bundle `index-BBg7sG64.js` matches the build.
