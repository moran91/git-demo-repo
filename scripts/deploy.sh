#!/usr/bin/env bash
# One-command Firebase deploy in dependency order.
#
#   ./scripts/deploy.sh <project-id> [--rules-only]
#
# Fails early and loudly rather than shipping a broken bundle. Requires that you are
# authenticated (`firebase login`, or GOOGLE_APPLICATION_CREDENTIALS pointing at a service account).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-}"
MODE="${2:-full}"
if [ -z "$PROJECT" ]; then
  echo "usage: ./scripts/deploy.sh <project-id> [--rules-only]" >&2
  exit 64
fi

# firebase-tools routes its own calls through HTTPS_PROXY when set, which breaks in sandboxes.
FIREBASE=(env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy firebase)

echo "==> Checking authentication"
if ! "${FIREBASE[@]}" projects:list --project "$PROJECT" >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Not authenticated (or no access to that project).

  Interactive:     firebase login
  CI/headless:     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
                   (roles: Firebase Admin, Cloud Functions Admin, Service Account User)

Then re-run this script.
MSG
  exit 1
fi
echo "    ok"

echo "==> Deploying Firestore rules, indexes and Storage rules"
"${FIREBASE[@]}" deploy --only firestore:rules,firestore:indexes,storage --project "$PROJECT"

if [ "$MODE" = "--rules-only" ]; then
  echo "Done (rules only). Composite indexes may take a few minutes to finish building."
  exit 0
fi

# `npm run build` runs apps/web/scripts/check-env.mjs, which refuses placeholder/emulator config.
if [ -f apps/web/.env.local ] && grep -q 'VITE_USE_EMULATORS=1' apps/web/.env.local 2>/dev/null; then
  cat >&2 <<'MSG'

WARNING: apps/web/.env.local sets VITE_USE_EMULATORS=1.
Vite loads .env.local in production builds too, so it overrides .env.production.
The preflight check will refuse the build. Move your emulator settings aside first:

  mv apps/web/.env.local apps/web/.env.local.bak

MSG
fi

echo "==> Building (typecheck + functions bundle + web bundle)"
npm run build

echo "==> Deploying Cloud Functions"
"${FIREBASE[@]}" deploy --only functions --project "$PROJECT"

echo "==> Deploying Hosting"
"${FIREBASE[@]}" deploy --only hosting --project "$PROJECT"

echo
echo "Deployed. Live URL:"
"${FIREBASE[@]}" hosting:sites:list --project "$PROJECT" 2>/dev/null | sed -n 's/.*\(https:\/\/[^ │|]*\).*/  \1/p' | head -3 || echo "  https://${PROJECT}.web.app"
cat <<'MSG'

Post-deploy checklist (docs/DEPLOYMENT.md section 10):
  1. Open the site — discovery loads (empty until a business is approved).
  2. Authentication -> Settings: add the Hosting domain to Authorized domains,
     and restrict the SMS region policy to Israel (+972).
  3. Bootstrap the first admin:
       node --experimental-strip-types scripts/src/bootstrap-admin.ts <email>
  4. Create cities in /admin/cities (Beit Jann first), then invite owners.
MSG
