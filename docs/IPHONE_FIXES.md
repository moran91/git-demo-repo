# iPhone storefront and phone sign-in fixes — 2026-09-21

Item and combo sheets now open at 92% of the mobile viewport height. The sheet is explicitly anchored to the bottom; its options use an auto flex basis and a zero minimum height so Safari can size and scroll them reliably. The header and cart action do not shrink. Desktop dialog sizing remains content-driven.

Phone sign-in keeps one reCAPTCHA container across phone/code transitions, creates a fresh verifier for each send, and cleans it up afterwards. Rejected invisible challenges (`invalid-app-credential`, `missing-app-credential`, `captcha-check-failed`, or `internal-error`) receive one visible-challenge retry. Rate limits and SMS quota failures are not retried automatically. Known verification/configuration errors have specific translated messages, and diagnostics log only error codes. Duplicate submissions are guarded, and Arabic verification digits are normalized.

Verification:

- Production web build and web/E2E typechecking passed.
- Changed-file lint passed with no errors (the existing lint configuration ignores `src/lib/errors.ts`).
- 56 shared unit tests passed.
- 12 regression checks passed across iPhone WebKit and mobile Chromium, including both text directions, viewport height changes, access to first/last options, visible verification recovery, resend, number changes, invalid OTP, and rate-limit/quota handling.
- All 4 existing media layout checks passed in WebKit and Chromium.
- Read the live Firebase Auth configuration: Phone enabled, Hosting domains authorized, Israel allowed for SMS.

Reproduce browser checks after `npm run build -w apps/web`:

```sh
npx playwright test -c e2e/iphone.config.ts
npx playwright test -c e2e/media-layout.config.ts
```

The regression tests use the real built app and Firebase SDK, with external authentication responses and CAPTCHA interactions stubbed. They do not send SMS. Physical iPhone behavior and actual carrier SMS delivery have not been verified; the exact error from the reporting iPhone was unavailable. The visible challenge recovery covers a reproducible failure path that previously displayed the generic error.

Deployment: Firebase Hosting released to https://qareeb-dev.web.app; hosted entry matches the tested production bundle `index-BrtNVU6P.js`. The deployed visible-challenge recovery regression passed in iPhone WebKit. A live restaurant's options and footer were accessible. Google reCAPTCHA also completed on the deployed phone page and reached the SMS request (delivery intercepted). A combined menu-to-sign-in smoke run reported two Firestore streaming access-control errors during navigation after interception was enabled; the requested popup and SMS-request assertions passed.

An additional fresh-session live Google reCAPTCHA run remained on the verification step and did not reach the code screen within 45 seconds. Its snapshot showed verification iframes and a pending Send code button, not the reported generic error. Automated Google verification is therefore not consistently verified; a physical-device check completing any Google challenge and receiving an actual SMS remains necessary.

## Follow-up: phone verification still failed on the reporting iPhone

The first release did not resolve the reported phone problem. The exact exception from that device was unavailable, so the follow-up addresses additional browser failure paths and makes any remaining failure identifiable rather than claiming a confirmed device-level diagnosis.

- Upgraded Firebase from 12.18.0 to 12.19.0, which includes recovery from failed authentication persistence initialization and iOS database lifecycle failures: https://firebase.google.com/support/release-notes/js#version_12190_-_september_9_2026.
- Initialize Auth with local/session/memory persistence directly. Phone and password sign-in no longer initialize the unused cross-origin OAuth popup iframe or first open Auth IndexedDB only to switch persistence afterwards.
- Replaced invisible verification and its automatic retry with a visible security check for each send. Authentication initialization, script loading, challenge completion and SMS sending have separate states.
- Handle script exceptions, provider error/expiry callbacks, initialization/loading/challenge timeouts, cancellation, and cleanup exceptions. An abandoned challenge cannot later send an SMS. An in-flight delivery request is not cancelled or retried automatically.
- Phone and consent inputs are frozen during a send. Every unknown SMS/browser failure gets a specific user-facing message and a sanitized stage/error reference; references contain no phone number, OTP or token.

The production build, workspace typechecking, changed-file lint, 56 shared tests and 22 browser checks passed. The browser checks cover visible verification before any SMS request, rejection of an invalid OTP, resends, changed numbers, SMS quota/rate limits, raw script errors, provider error and expiry callbacks, cancellation with a late callback, and unavailable browser storage. Service responses and CAPTCHA completion are simulated in these regressions; actual carrier delivery is not represented by them.

The 2 additional stalled-script timeout/retry checks passed (24 browser regressions total). Hosting deployment completed; the live entry is `index-CRREXYM9.js`. Live iPhone WebKit verified the genuine Google checkbox loads, the unused OAuth iframe is absent, cancellation restores the form, and no page exceptions occur. The deployed verification and restricted-storage regression checks both passed. No real SMS was sent by these automated checks. A Safari-device retest was requested from the reporting user.

## Follow-up: provider delivery failures and incomplete error references

The reporting Safari user saw `sending/FirebaseError` and has not compared the same number on another device. This confirms the application reached the SMS request stage, but does not establish an iPhone-only cause.

Live Cloud Monitoring data for the preceding 24 hours, inspected on 2026-09-21 around 20:40 UTC, showed 3 successful SendVerificationCode requests (HTTP 200) and 6 failed requests (HTTP 503 / gRPC 14). SMS metrics recorded 3 sends to Israel and no blocked-SMS time series. Billing and phone authentication are enabled; Israel is on the SMS region allowlist. Aggregate metrics cannot identify the reporting user's individual request or explain the provider's 503 response.

The diagnostic sanitizer incorrectly discarded numeric Firebase errors such as `auth/error-code:-39`, falling back to `FirebaseError`. It now preserves this restricted numeric-code format without exposing arbitrary exception messages or phone data. The user's actual numeric code is still unknown; error 39 is a regression fixture, not a confirmed diagnosis.

Production build and the new numeric-code regression passed in WebKit and Chromium. Hosting deployment completed and the live entry is `index-05jc8O1f.js`. The same regression passed against the deployed app in iPhone WebKit with the external response simulated. Actual SMS delivery remains unresolved and unverified; the user was asked to retry once on the updated app and provide the complete reference if it fails.

The user subsequently confirmed `sending/error-code:-39` on a Partner Israel number. See [SMS_DELIVERY.md](SMS_DELIVERY.md) for the provider diagnosis, completed SMS Defense prerequisites, pending Cloud Console activation, rollback plan and unsubmitted support draft. Ten targeted browser checks passed for the specific error message and SMS Defense SDK behavior. A Hosting release with the clearer delivery-unavailable message completed; the live entry is `index-D0oMGImd.js`. This release improves the error handling; it does not resolve provider delivery. Auth SMS Defense enforcement remains unchanged until the required console activation and verification can be completed.

On September 22 (local time), the signed-in Cloud Console became available. The organization warning came from Security Command Center, not the separate Fraud Defense settings. SMS Defense was activated in Fraud Defense, connected to Firebase Auth in AUDIT mode, and verified with genuine WebKit tokens and a real SMS fraud assessment for a reserved fictional number (no SMS sent). Auth was then switched to ENFORCE with Google's recommended initial 0.8 threshold. This is a live server-side configuration release; the hosted application bundle is unchanged. Actual SMS receipt and OTP verification on the reporting Partner number remain pending. See the delivery investigation for complete checks and limitations.
