/**
 * Production build preflight.
 *
 * Vite loads `.env.local` in EVERY mode, including production builds. A developer following the
 * local quick start therefore has emulator settings (`VITE_USE_EMULATORS=1`, `demo-api-key`) baked
 * into `npm run build` output, which deploys a site that silently talks to 127.0.0.1. This check
 * turns that into a loud failure before anything is uploaded.
 *
 * Bypass for a deliberate emulator-targeted bundle: QAREEB_ALLOW_EMULATOR_BUILD=1
 */
import { loadEnv } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const env = loadEnv(mode, root, 'VITE_');
const allowEmulator = process.env.QAREEB_ALLOW_EMULATOR_BUILD === '1';

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
// Values shipped in .env.example; deploying them produces a non-functional site.
const PLACEHOLDERS = [/^demo-/i, /^0{6,}$/, /^1:0{6,}:web:0+$/, /qareeb-dev/];

const problems = [];
if (env.VITE_USE_EMULATORS === '1' && !allowEmulator) {
  problems.push('VITE_USE_EMULATORS=1 — this bundle would connect to local emulators, not your Firebase project.');
}
for (const key of REQUIRED) {
  const value = (env[key] ?? '').trim();
  if (!value) problems.push(`${key} is missing.`);
  else if (!allowEmulator && PLACEHOLDERS.some((re) => re.test(value))) problems.push(`${key}="${value}" is an example placeholder, not real project config.`);
}
if (!env.VITE_FCM_VAPID_KEY) console.warn('[preflight] VITE_FCM_VAPID_KEY is empty — web push will be disabled (the in-app inbox still works).');
if (!env.VITE_APPCHECK_SITE_KEY) console.warn('[preflight] VITE_APPCHECK_SITE_KEY is empty — App Check will not be initialised.');

if (problems.length > 0) {
  console.error('\n[preflight] Refusing to build a production bundle with this configuration:\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error(`
Fix: put your real Firebase web config in apps/web/.env.production with
VITE_USE_EMULATORS=0, and make sure apps/web/.env.local does not override it
(Vite loads .env.local in production builds too — rename it while deploying, or
keep emulator settings only in .env.local and real values in .env.production.local).

Config: Firebase console -> Project settings -> General -> Your apps -> SDK setup and configuration.
To build an emulator-targeted bundle on purpose: QAREEB_ALLOW_EMULATOR_BUILD=1 npm run build
`);
  process.exit(1);
}
console.log(`[preflight] ok — targeting Firebase project "${env.VITE_FIREBASE_PROJECT_ID}" (emulators: ${env.VITE_USE_EMULATORS === '1' ? 'YES (explicitly allowed)' : 'no'})`);
