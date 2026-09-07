# Deployment guide (Firebase)

> The authoring environment had no Firebase project credentials and could not reach
> `firebase.google.com` documentation. Everything below was verified against the pinned SDK versions
> (`firebase@12`, `firebase-admin@14`, `firebase-functions@7`, `firebase-tools@15`) and the emulator
> suite. Re-check console menu labels against the official docs listed at the end before going live.

## Quick path (after the one-time console setup in sections 1–6)

```
./scripts/deploy.sh <project-id>              # rules + indexes, functions, hosting, in order
./scripts/deploy.sh <project-id> --rules-only # rules/indexes only (no build needed)
```
The script verifies authentication first, then runs `npm run build`, which refuses to produce a
bundle from placeholder or emulator configuration.

> **Trap: `apps/web/.env.local` also applies to production builds.**
> Vite loads `.env.local` in *every* mode, so the emulator settings from the local quick start
> (`VITE_USE_EMULATORS=1`, `demo-api-key`) silently override `.env.production` and produce a
> deployable bundle that talks to `127.0.0.1`. Before deploying, move it aside:
> ```
> mv apps/web/.env.local apps/web/.env.local.bak
> ```
> `apps/web/scripts/check-env.mjs` (run by `npm run build`) now fails loudly on this instead of
> shipping a broken site, and `USE_EMULATORS` additionally requires a dev build at runtime.

## 0. Prerequisites and cost expectations
- A Google account with billing. Cloud Functions v2, Cloud Storage and outbound SMS require the
  **Blaze (pay-as-you-go)** plan. "Free for businesses" refers to platform fees only: Firebase
  infrastructure, Firestore reads/writes, Cloud Run/Functions time, Storage and **SMS OTP messages are
  billed to the project owner**.
- Create a **budget with alerts** in Google Cloud Billing (e.g. ₪100/₪300/₪1000 thresholds). Budget
  alerts notify you; **they are not a hard spending cap**. `maxInstances` in `functions/src/index.ts`
  (currently 20) and Firebase quotas are the practical caps.
- Keep **two projects**: `qareeb-dev` and `qareeb-prod` (see `.firebaserc.example`). Never point the dev
  web build at production.

## 1. Create the project
1. Firebase console → Add project (e.g. `qareeb-prod`).
2. Upgrade to Blaze and link the billing account. Set the budget alert (Cloud console → Billing → Budgets).
3. Project settings → Default GCP resource location: **me-west1 (Tel Aviv)**. This fixes the Firestore and
   default Storage bucket location and is **immutable**. If me-west1 is unavailable for your account, use
   `europe-west1` and change `FUNCTIONS_REGION` / `VITE_FUNCTIONS_REGION` together.

## 2. Authentication
Console → Build → Authentication → Get started.
- Sign-in methods: enable **Phone** and **Email/Password**.
- Settings → **Authorized domains**: add your Hosting domain(s) and custom domain.
- Settings → **SMS region policy**: allow **Israel (+972)** only. This limits SMS abuse and cost.
- Phone auth uses invisible reCAPTCHA in the web app; no extra web configuration is needed.
- Add **test phone numbers** only in the dev project.
- Templates: customize password-reset and email-verification templates; the app sets `auth.languageCode`
  from the UI language.

## 3. Firestore and Storage
- Firestore Database → Create database → **Standard edition**, production mode, location as above.
- Storage → Get started → same location. The bucket name goes into `VITE_FIREBASE_STORAGE_BUCKET`.
- Deploy rules and indexes: `npm run deploy:rules`. Index builds take minutes; discovery queries fail
  until they finish.

## 4. Cloud Functions
- Runtime **Node 22**, region `me-west1` (`firebase.json`, `functions/package.json`).
- Secrets (only if enabling WhatsApp OTP):
  ```
  firebase functions:secrets:set TWILIO_ACCOUNT_SID
  firebase functions:secrets:set TWILIO_AUTH_TOKEN
  firebase functions:secrets:set TWILIO_VERIFY_SERVICE_SID
  ```
- Create `functions/.env` from `functions/.env.example` with `APP_ORIGIN=https://<your-domain>` (invitation
  links) and `FUNCTIONS_REGION`.
- Deploy: `npm run deploy:functions`. The `predeploy` step bundles `functions/src` with esbuild into
  `functions/lib/index.js` (the workspace package is inlined).
- The Storage trigger and the scheduler require Eventarc / Cloud Scheduler APIs; the CLI enables them on
  first deploy. Functions run as the default compute service account; do not add extra roles.

## 5. App Check (recommended)
- App Check → register the web app with **reCAPTCHA v3**; put the site key in `VITE_APPCHECK_SITE_KEY`.
  Start in monitoring mode, enforce for Firestore/Storage/Functions after confirming tokens flow. For
  local development use a debug token (`VITE_APPCHECK_DEBUG_TOKEN`).
- Callables run with `enforceAppCheck: false` today; switch it on in `functions/src/domain/*` once enforced.

## 6. Cloud Messaging (web push)
- Project settings → Cloud Messaging → Web configuration → generate a **Web Push certificate** (VAPID);
  public key → `VITE_FCM_VAPID_KEY`.
- One service worker (`apps/web/sw/sw.ts`) does precaching **and** FCM background messages; it is served as
  `/sw.js` with `no-cache` headers. Updates are user-prompted (never silent), so FCM registrations are not
  invalidated mid-session.
- Push is best-effort: denied permission, unsupported browsers (iOS Safari without Add to Home Screen) and
  closed browsers do not receive messages. The in-app inbox is authoritative.

## 7. Web build and Hosting
```
cp apps/web/.env.example apps/web/.env.production   # then fill in the REAL config, VITE_USE_EMULATORS=0
mv apps/web/.env.local apps/web/.env.local.bak      # see the trap warning at the top of this file
npm ci
./scripts/deploy.sh <project-id>                    # or: npm run build && npm run deploy:hosting
```
Get the real values from Firebase console → Project settings → General → Your apps → SDK setup and
configuration. Deploying `.env.example` values produces a non-functional site; the preflight blocks it.
`firebase.json` has the SPA rewrite (`** → /index.html`), immutable caching for hashed assets/fonts,
`no-cache` for the service worker, and security headers. Deep links resolve to the app.
Custom domain: Hosting → Add custom domain → DNS verification; add it to Auth authorized domains and
`APP_ORIGIN`.

## 8. First admin (bootstrap)
1. Register through the app (`/business/register`) with the admin's email and verify the email.
2. With Application Default Credentials for the project:
   ```
   GCLOUD_PROJECT=qareeb-prod GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
     node --experimental-strip-types scripts/src/bootstrap-admin.ts admin@example.com
   ```
   The script refuses unverified emails, sets the `admin` claim + `isAdmin`, writes an audit entry and revokes
   refresh tokens (sign in again). Nothing else grants platform admin.

## 9. Reference data in production
The seed script is emulator-only. In production, create cities in `/admin/cities` (Beit Jann first) and
invite owners from `/admin/invite`.

## 10. Post-deployment smoke checks
- Discovery loads for Beit Jann (empty until a business is approved).
- Phone sign-in with a real Israeli number receives an SMS.
- Owner registration → email verification → business + branch → admin approval → visible publicly.
- Place a test order; dashboard receives it in real time; accept; record cash; loyalty points appear.
- Printers: run the multilingual test print on the actual launch printer (see PRINTING.md).

## 11. Optional WhatsApp OTP (Twilio Verify)
1. Create a Twilio Verify Service and enable the **WhatsApp** channel (requires an approved WhatsApp
   sender). Docs: https://www.twilio.com/docs/verify/whatsapp
2. Set the three secrets (section 4), redeploy functions. The web app shows the WhatsApp button only when
   configured (`authOptions`). SMS keeps working independently; Firebase's SMS API never sends WhatsApp.

## Official references (re-check at deploy time)
- Hosting: https://firebase.google.com/docs/hosting
- Phone auth (web): https://firebase.google.com/docs/auth/web/phone-auth
- Custom tokens: https://firebase.google.com/docs/auth/admin/create-custom-tokens
- FCM web: https://firebase.google.com/docs/cloud-messaging/web/get-started
- Pricing: https://firebase.google.com/pricing
