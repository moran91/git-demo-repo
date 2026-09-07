# Qareeb – implementation plan and requirement checklist

This file is the persistent progress record. Update it when work spans sessions.

## Repository findings (start of work)

- The repository contained only demo files (`README.md`, `file1.rb`, `file2.txt`, `file3.csv`). No design files were present in the repo, the scratchpad, or the user's Drive. The "CONCRETE VISUAL SPECIFICATION — QAREEB" section of the brief is self-contained and is used as the design baseline.
- Environment: Node 22, npm 10, JDK 21, Gradle 8.14, Chromium/Playwright. No Android SDK; `dl.google.com` is blocked by the egress policy, so the Android companion cannot be compiled here. `firebase.google.com` docs are blocked; `storage.googleapis.com` (emulator jars) and the npm registry are reachable. No Firebase project credentials exist in the session.

## Architecture (decided)

| Layer | Location | Notes |
|---|---|---|
| Shared domain | `packages/shared` | Types, zod schemas, money/weight math, opening hours, phone normalisation, localisation resolver, UI dictionaries (he/ar/en), receipt model + layout + ESC/POS encoder |
| Backend | `functions` | Firebase Functions v2 (Node 22), callable endpoints only for mutations, Firestore transactions, idempotency keys, outbox + FCM |
| Web | `apps/web` | React 19 + Vite + TypeScript PWA. Customer storefront, business dashboard, admin dashboard |
| Rules | `firestore.rules`, `storage.rules` | Clients read public projections and their own private docs; all mutations that matter are server-only |
| Seed | `scripts` | Emulator seed with fictional data |
| Tests | `packages/shared` (vitest), `functions` (vitest against emulator), `tests/rules`, `e2e` (Playwright) | |
| Android print station | `android/print-station` | Kotlin source, RFCOMM ESC/POS transport, Firebase sign-in, job queue consumer |

Regions: `me-west1` (Tel Aviv) for Firestore, Storage and Functions (see `docs/DEPLOYMENT.md`).

## Requirement checklist

Legend: [x] implemented and verified locally · [~] implemented, needs external/hardware verification · [ ] not done

### Product
- [x] Customer storefront, business dashboard, admin dashboard
- [x] City selection (Beit Jann seeded, admin-managed), pickup/delivery modes, restaurant/supermarket tabs
- [x] Village address with house description first; street never required
- [x] Cash only; three order statuses only (placed/accepted/rejected)
- [x] Owners: multiple businesses/branches; managers/staff branch-limited; platform admin
- [x] Approval states separate from order status (pending/approved/rejected/suspended) for businesses and branches
- [x] Favorites, business-scoped loyalty with ledger, reservations, earn on cash record only
- [x] Substitutions / actual weight revisions with phone-agreement record, version checks
- [x] Cash records separate from status; audited reconciliation/reversals
- [x] Notifications inbox + FCM web push via outbox
- [x] Bluetooth printing subsystem (receipt model, raster renderer, ESC/POS, Web Bluetooth BLE profiles, print jobs/stations/leases, Android companion source)
- [x] PWA installable, SW update strategy, no private data cached

### Technical
- [x] React/TS/Vite, Firebase Hosting config with SPA rewrites, Auth, Firestore, Storage, Functions (TS), FCM, App Check wiring
- [x] Lockfile, pinned versions
- [x] Zod runtime validation, structured errors, server timestamps, bounded pagination
- [x] Firestore indexes, rules, emulator config, env examples, seed, reproducible commands
- [x] Hebrew default; he/ar RTL; en LTR; persisted language; logical CSS; bdi isolation
- [x] ILS formatting; Asia/Jerusalem times
- [x] Design tokens per spec; Noto Sans self-hosted (he/ar/latin), weights 400/500/600

### Verification
- [x] Domain unit tests (pricing, loyalty, hours, phone, receipt layout, ESC/POS encoding)
- [x] Functions integration tests against emulator (orders, stock race, idempotency, loyalty, substitutions, printing)
- [x] Rules tests
- [x] Playwright e2e + screenshots (360/390/768/1440, he/ar/en)
- [~] Real Bluetooth printer hardware test — blocked: no hardware/printer model provided
- [~] Live Firebase deployment — blocked: no project credentials in session
- [~] Android APK build — blocked: Android SDK not downloadable in this environment

See `docs/STATUS.md` for the current status report and remaining external steps.
