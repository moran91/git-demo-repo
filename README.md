# Qareeb — neighborhood marketplace (restaurants & supermarkets), starting in Beit Jann

"Qareeb" is a working brand name (editable in `packages/shared/src/brand.ts`), not a trademark claim.

Installable PWA (customer storefront, business dashboard, platform admin) on Firebase — Hebrew (default),
Arabic and English with RTL/LTR, cash on pickup/delivery, village house descriptions instead of street
addresses, three-status orders (placed → accepted | rejected), business-scoped loyalty, and Bluetooth
receipt printing with a web BLE station and an Android RFCOMM companion.

| Doc | Contents |
|---|---|
| `docs/STATUS.md` | What is done, what was verified, what remains blocked |
| `docs/IMPLEMENTATION_PLAN.md` | Requirement checklist |
| `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md` | Design notes |
| `docs/DEPLOYMENT.md` | Firebase project setup and deployment |
| `docs/TESTING.md` | Reproducible commands and test coverage |
| `docs/PRINTING.md` | Printing design, compatibility table, physical test checklist |
| `docs/OPERATIONS.md` | User-facing operating instructions |
| `docs/DESIGN_VERIFICATION.md`, `docs/screenshots/` | Design review notes and captures |

Quick start (local, emulator-backed):
```
npm ci
./scripts/emulators.sh                      # terminal 1
SEED_ALWAYS_OPEN=1 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=qareeb-dev node --experimental-strip-types scripts/src/seed.ts
cp apps/web/.env.example apps/web/.env.local && npm run dev -w apps/web   # terminal 2 → http://127.0.0.1:5173
```
Seed accounts are listed in `docs/TESTING.md`.

---
The pre-existing demo files (`file1.rb`, `file2.txt`, `file3.csv`) are unrelated to this application and left untouched.
