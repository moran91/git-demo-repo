# Architecture

Qareeb is a Firebase-backed marketplace PWA with three interfaces (customer storefront, business
dashboard, platform admin) sharing one React/Vite codebase, one TypeScript domain package, and one
set of authenticated Cloud Functions.

```
apps/web            React 19 + Vite 8 PWA (customer / business / admin routes, Web Bluetooth print station)
packages/shared     Domain types, zod schemas, money & hours math, i18n dictionaries, receipt model/renderer/ESC-POS
functions           Firebase Functions v2 (Node 22): callables, Firestore/Storage/schedule triggers
android/print-station  Kotlin companion: RFCOMM ESC/POS print station consuming the same job queue
scripts             Emulator seed, first-admin bootstrap, icon generation
tests/rules         Firestore security-rules tests
e2e                 Playwright browser tests + design screenshots
```

## Layering

| Concern | Where | Notes |
|---|---|---|
| Domain logic | `packages/shared/src/{pricing,money,hours,localize,phone}.ts` | Pure, unit-tested, shared by client preview and server |
| Request/response contracts | `packages/shared/src/schemas.ts` (zod) | Parsed on the server with `stripNulls` (callable SDKs send `null` for `undefined`) |
| Firebase access | `apps/web/src/lib/{firebase,api,queries}.ts`, `functions/src/lib/firebase.ts` | Web reads Firestore directly under rules; all mutations go through callables |
| Localization | `packages/shared/src/i18n`, `apps/web/src/lib/i18n.tsx` | Typed dictionaries (missing keys fail typecheck); `resolveLocalized` for business content |
| UI components | `apps/web/src/design` | Tokens in CSS custom properties, one icon family, native `<dialog>` |

## Authority and trust

- Clients never write roles, approval states, totals, stock, loyalty balances, order status, print
  jobs, or verified-phone flags. Rules (`firestore.rules`) make those collections read-only or closed.
- Every callable independently re-verifies: auth → user document (suspension) → role & branch
  membership → payload → resource ownership. Admin SDK bypasses rules, so nothing relies on them.
- Idempotency: `idempotency/{uid}_{key}` written inside the same transaction as the effects.
- Concurrency: Firestore transactions + `order.version` optimistic checks + print-job lease fences.
- Public discovery reads server-written projections (`publicBusinesses`, `publicBranches/**`) that
  exist only while both business and branch are approved. Private data never appears there.

## Order lifecycle (only three statuses)

`placed → accepted | rejected`. Everything else (revisions, cash, printing, loyalty) is orthogonal
state on the order or in side collections. See `docs/DATA_MODEL.md` for invariants.

## Notifications

Transactions enqueue `outbox/{deterministicKey}`; `onOutboxCreated` fans out to inbox documents and
FCM; `scheduledSweeps` retries pending entries every 5 minutes. Payloads carry references and deep
links only.

## Printing

See `docs/PRINTING.md`. The server stores an immutable receipt model per job; browser (Web
Bluetooth BLE), Android station (RFCOMM) and the OS print dialog all render that same model.

## Regions

`me-west1` (Tel Aviv) for Firestore, Storage bucket and Functions (Cloud Run gen2 region). Auth, FCM and
Hosting are global. Change `FUNCTIONS_REGION` / `VITE_FUNCTIONS_REGION` together if you pick another
region; Firestore location is immutable once created.
