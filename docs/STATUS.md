# Status report

_Last updated: 2026-09-07 (authoring session). This file distinguishes what was verified locally from
what remains blocked on external access or hardware._

## Verified locally (Firebase Emulator Suite, Chromium)
| Area | Evidence |
|---|---|
| Domain rules (pricing, modifiers, weights, loyalty math, hours incl. DST/overnight, phone normalisation) | `packages/shared` vitest — 26 tests |
| Receipt model + raster rendering (he/ar/en, 58/80 mm) + ESC/POS encoding, no cash-drawer bytes | same suite; fixtures in `docs/print-fixtures/` (labelled SIMULATION) |
| Backend callables: place/decide/revise/cash/reverse, stock race, idempotency, notifications fan-out, approvals, suspension, memberships, printer setup, stations, leases/fences, duplicate copies, metrics | `functions` vitest — 16 integration tests against emulators |
| Firestore security rules (isolation, branch limits, closed collections, suspended users) | `tests/rules` — 10 tests |
| Browser flows: guest discovery in he/ar/en with direction switch, restaurant order with modifiers → phone sign-in → village-address delivery checkout → order reference/status/Call business; cart replacement confirmation; deep-link 404; manager accepts in real time; staff branch limits; admin approvals page | `e2e` Playwright — 20 tests (7 flows + 13 screenshot captures) |
| Design captures at 360/390/768/1440 in three languages | `e2e/screenshots.spec.ts` (output not committed), notes in `docs/DESIGN_VERIFICATION.md` |
| Build/typecheck/lint | `npm run typecheck`, `npm run build`, `npm run lint` |

## Implemented but only verifiable outside this environment
- **Real SMS phone sign-in** (reCAPTCHA + Firebase Phone Auth): implemented; emulator accepts any code.
- **Web push (FCM)**: service worker + token registration + server sends implemented; needs a VAPID key and a real project.
- **WhatsApp OTP** (Twilio Verify): implemented and config-gated; hidden until secrets exist.
- **Image resizing trigger** (sharp) and Storage rules: implemented; the Storage emulator does not run the
  finalize trigger with the same fidelity as production — verify after first deploy.
- **App Check**: wired for reCAPTCHA v3 when a site key is set.

## Added after review: compact add button, "Best seller", combo deals

- **Compact add control**: product cards use a 48 px round green "+" (accessible name "Add to cart: <item>",
  in-cart count badge) instead of the labelled button.
- **Best seller**: owners/managers toggle it per product (editor checkbox or the star on the catalog list;
  callable `setProductMostOrdered`); customers see the green label above the name.
- **Combo deals**: owners bundle any unit-priced items of a branch with quantities and a 1–90 % discount
  (`saveCombo`, `setComboArchived`, `setComboImage`). Prices are never stored on the combo: the server sums
  the members' *current* prices at quote/placement, so catalog changes flow through and a stale client price
  is refused with `price_changed`. Member stock is reserved/released per bundled unit. Combo lines snapshot
  the members and discount on the order and print them on tickets. Revisions may remove a combo line but not
  re-quantify it. Promoted combos appear in a Deals rail at the top of the storefront.
- **Promo image**: composed entirely on the owner's device from the item photos with the discount badge
  (`apps/web/src/deals/promoImage.ts`); only the final JPEG is uploaded. The optional "cut out backgrounds"
  step runs an on-device segmentation model (`@huggingface/transformers`, `briaai/RMBG-1.4` quantized,
  ~44 MB one-time download, WASM in the browser). RMBG-1.4 is not a pipeline-supported architecture, so it
  is driven as a "custom" `AutoModel` + `AutoProcessor` exactly as the transformers.js docs describe.
  **Verified 2026-09-14 in Chromium against the emulators**: ~12 s first load, ~20 s per 1200 px photo, clean
  cutouts on plated food and a can; any failure falls back to the plain compositor with a visible notice.
  The runtime chunk (~0.5 MB) is loaded on demand and excluded from the service-worker precache.
- **Deals page**: one dashboard page (`deals`) holds combos and the text promotions; `promotions` redirects there.
- Tests: shared combo pricing (2 new), functions `combos.test.ts` (3 new: most-ordered permissions, combo
  validation/projection, combo order pricing + member stock + rejection release), browser check of the
  deals rail, combo sheet, cart totals and the editor's generator.

## Deployment blockers found and fixed (post-review)

A deploy attempt failed with "imports from a `lib/` folder that doesn't exist". Two real defects, both mine:

1. **`.gitignore` swallowed source directories.** The pattern `lib/` (no leading slash) matches any
   directory named `lib` at any depth, so `functions/src/lib/` and `apps/web/src/lib/` (24 files) were
   never committed. Every local check passed because it ran against the working tree, where the files
   exist. Fixed by anchoring the patterns to `functions/lib/` and `apps/web/dist/` and committing the
   files. **A clean clone now builds green** — that is the check that would have caught it.
2. **Emulator config leaked into production bundles.** Vite loads `.env.local` in every mode, so the
   quick-start emulator settings overrode `.env.production`; the built bundle contained `demo-api-key`,
   `127.0.0.1:9099` and the emulator-only custom-token sign-in hook. A deploy would have "succeeded"
   and served a dead site. Fixed with a build preflight (`apps/web/scripts/check-env.mjs`) that refuses
   placeholder/emulator config, plus a runtime guard so `USE_EMULATORS` requires a dev build and the
   test hook cannot exist in production output. Verified in both directions.

Also added `scripts/deploy.sh` (auth check → rules/indexes → functions → hosting, in order).

## Blocked / not done here
| Item | Why | What is needed |
|---|---|---|
| Live Firebase deployment and real URL | No project credentials/billing in the session | Follow `docs/DEPLOYMENT.md` sections 1–10, then run the smoke checks |
| Real Bluetooth printing verification | No printer hardware; launch model unknown | Printer make/model + shop device OS; run `docs/PRINTING.md` checklist |
| Android companion APK | Android SDK download (`dl.google.com`) blocked by the environment proxy | Build with Android Studio / SDK 35 per `android/print-station/README.md` |
| Official Firebase docs re-check | `firebase.google.com` blocked by proxy | Re-verify console labels/limits before production |
| Dark mode | Optional; palette tokens are defined, toggle not exposed | Product decision |
| Native customer/business apps | Future work by design | Shared domain types + callables are app-agnostic |

## Known limitations / follow-ups
- The favourites page now resolves product names from the public catalog, but no screen creates a
  product favourite yet — only businesses can be favourited, so that section stays empty in practice.
- Android renderer bundles the Hebrew Noto face and relies on system fonts for Arabic/Latin (documented).
- Invitation emails are logged (emulator) rather than sent; production needs a transactional email path or
  Firebase's password-setup email flow wired to the invitation link.
- The `os_print_dialog` path is the only "verified" print path, and it is explicitly not Bluetooth.

## Reproduce everything
See `docs/TESTING.md`.
