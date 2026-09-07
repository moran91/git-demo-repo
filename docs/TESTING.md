# Testing and reproducible commands

```
npm ci                                   # all workspaces
npm run typecheck                        # every workspace
npm run test -w packages/shared          # domain + receipt fixture tests (writes docs/print-fixtures/*.png)
./scripts/emulators.sh                   # Auth, Firestore, Functions, Storage emulators (proxy vars cleared)
npm run test -w functions                # integration tests against running emulators (re-seeds first)
npm run test -w tests/rules              # security rules tests (Firestore emulator on :8080)
npm run dev -w apps/web                  # http://127.0.0.1:5173 with VITE_USE_EMULATORS=1 (.env.local)
npm run test -w e2e                      # Playwright (needs emulators + seed + dev server)
npm run screenshots -w e2e               # design review captures into docs/screenshots
```

Seed (fictional, refuses to run without emulator hosts):
```
SEED_ALWAYS_OPEN=1 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  GCLOUD_PROJECT=qareeb-dev node --experimental-strip-types scripts/src/seed.ts
```
`SEED_ALWAYS_OPEN=1` gives branches 24/7 hours so tests do not depend on the wall clock; omit it to see real
opening hours (restaurant 11:00–01:00 overnight).

Seed accounts (password `Qareeb-Test-1234`; phone codes: any 6 digits in the Auth emulator):
| Role | Account |
|---|---|
| Platform admin | admin@qareeb.test |
| Owner, restaurant (2 branches) | owner.restaurant@qareeb.test |
| Owner, supermarket | owner.market@qareeb.test |
| Owner, pending business | owner.pending@qareeb.test |
| Manager (branch A only) | manager.a@qareeb.test |
| Staff (branch B only) | staff.b@qareeb.test |
| Customers (verified phone) | +972501111111, +972502222222 |

## Coverage of the acceptance scenarios
- `packages/shared/test`: pricing/modifier validation, weight rounding, loyalty caps/earning, Asia/Jerusalem
  hours incl. DST and overnight, phone normalisation, receipt model ordering (house description first, pickup
  without address, rejected label, cash-received gating, copy/revised labels), raster output within printable
  width for 58/80mm in he/ar/en, ESC/POS headers, forbidden cash-drawer commands, BLE chunking.
- `functions/test` (scenarios 2, 3, 4, 5, 6, 7, 8, 9 server side, 10, 13 queue side): placement with a village
  address, idempotent replay, staff-only fan-out, snapshot immutability, invalid modifiers/prices/city/
  minimum/unapproved/other-branch, stock race, decisions with version conflicts and branch limits, weights +
  substitutions + phone agreement, cash gating and single earn, cross-business redemption failure, reversal
  ledger and debt, printer setup gating, station exclusivity, lease fences, partial → needs_review,
  deterministic auto-print job, duplicate copies, revised labels, approvals publish/hide, membership
  revocation, suspension, admin metrics.
- `tests/rules` (scenario 9 client side): customer isolation, staff branch limits, owner isolation, financial
  visibility, closed server collections, suspended users.
- `e2e` (scenarios 1, 2 browser, 5, 11 deep link, 12 screenshots at 360/390/768/1440 in he/ar/en).

## Not verified here
Real SMS/push delivery, real Bluetooth hardware, the Android build, and production deployment (`docs/STATUS.md`).
