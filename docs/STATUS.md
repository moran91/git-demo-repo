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
| Design captures at 360/390/768/1440 in three languages | `docs/screenshots/`, notes in `docs/DESIGN_VERIFICATION.md` |
| Build/typecheck/lint | `npm run typecheck`, `npm run build`, `npm run lint` |

## Implemented but only verifiable outside this environment
- **Real SMS phone sign-in** (reCAPTCHA + Firebase Phone Auth): implemented; emulator accepts any code.
- **Web push (FCM)**: service worker + token registration + server sends implemented; needs a VAPID key and a real project.
- **WhatsApp OTP** (Twilio Verify): implemented and config-gated; hidden until secrets exist.
- **Image resizing trigger** (sharp) and Storage rules: implemented; the Storage emulator does not run the
  finalize trigger with the same fidelity as production — verify after first deploy.
- **App Check**: wired for reCAPTCHA v3 when a site key is set.

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
- Product favourites are stored but the favourites page shows product IDs (business favourites are complete).
- Android renderer bundles the Hebrew Noto face and relies on system fonts for Arabic/Latin (documented).
- Invitation emails are logged (emulator) rather than sent; production needs a transactional email path or
  Firebase's password-setup email flow wired to the invitation link.
- The `os_print_dialog` path is the only "verified" print path, and it is explicitly not Bluetooth.

## Reproduce everything
See `docs/TESTING.md`.
