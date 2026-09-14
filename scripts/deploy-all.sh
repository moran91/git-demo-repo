#!/usr/bin/env bash
# Zero-config, end-to-end deploy of Qareeb to a Firebase project.
#
#   ./scripts/deploy-all.sh            # deploys to qareeb-dev
#   ./scripts/deploy-all.sh <project>  # deploys to another project
#
# What it does, in order (each step is idempotent, re-running is safe):
#   1. Installs dependencies if needed and makes sure the Firebase CLI is available.
#   2. Logs you in to Firebase if you are not already (this opens a browser tab once).
#   3. Registers a Web app on the project if none exists and pulls its SDK config
#      straight from Firebase into apps/web/.env.production. Nothing to copy by hand.
#   4. Moves an emulator-flavoured apps/web/.env.local aside for the build and restores it after.
#   5. Deploys Firestore rules + indexes, Storage rules, Cloud Functions, then builds and deploys Hosting.
#   6. Checks the live site actually serves the new bundle (Deals & combos, Most ordered).
#
# Only one thing may need you: the browser login in step 2, once per machine.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-qareeb-dev}"
REGION="me-west1"
WEB_DIR="apps/web"
ENV_PROD="$WEB_DIR/.env.production"
ENV_LOCAL="$WEB_DIR/.env.local"
ENV_LOCAL_BAK="$WEB_DIR/.env.local.deploy-bak"
SCRATCH="$(mktemp -d)"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

restore() {
  if [ -f "$ENV_LOCAL_BAK" ]; then mv -f "$ENV_LOCAL_BAK" "$ENV_LOCAL"; fi
  rm -rf "$SCRATCH"
}
trap restore EXIT

# ---------------------------------------------------------------- 1. toolchain
say "Checking toolchain"
command -v node >/dev/null || die "Node.js 22+ is required (https://nodejs.org)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 22+ is required, found $(node -v)."
if [ ! -d node_modules/vite ] || [ ! -d node_modules/firebase-admin ]; then
  say "Installing dependencies (npm ci)"
  npm ci
fi
# firebase-tools routes its own calls through HTTPS_PROXY when set, which breaks in some sandboxes.
if command -v firebase >/dev/null; then
  FIREBASE=(env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy firebase)
else
  FIREBASE=(env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx --yes firebase-tools@15)
fi
echo "    node $(node -v), firebase-tools $("${FIREBASE[@]}" --version 2>/dev/null | tail -1)"

# ---------------------------------------------------------------- 2. auth
say "Checking Firebase authentication"
if ! "${FIREBASE[@]}" projects:list >/dev/null 2>&1; then
  if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    die "GOOGLE_APPLICATION_CREDENTIALS is set but cannot list projects. Check the service account roles."
  fi
  echo "    Not logged in. A browser tab will open; pick the Google account that owns '$PROJECT'."
  "${FIREBASE[@]}" login
fi
if ! "${FIREBASE[@]}" projects:list 2>/dev/null | grep -q "$PROJECT"; then
  die "Project '$PROJECT' is not visible to this account. Run 'firebase login --reauth' with the right account."
fi
echo "    ok"

# ---------------------------------------------------------------- 3. web config
say "Fetching the Web app SDK config for $PROJECT"
APP_ID="$("${FIREBASE[@]}" apps:list WEB --project "$PROJECT" --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result||[];console.log(r[0]?.appId||"")}catch{console.log("")}})')"
if [ -z "$APP_ID" ]; then
  echo "    No Web app registered yet; creating one"
  "${FIREBASE[@]}" apps:create WEB "Qareeb web" --project "$PROJECT" >/dev/null
  APP_ID="$("${FIREBASE[@]}" apps:list WEB --project "$PROJECT" --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||[];console.log(r[0]?.appId||"")})')"
fi
[ -n "$APP_ID" ] || die "Could not create or find a Web app on $PROJECT."
"${FIREBASE[@]}" apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" --json > "$SCRATCH/sdk.json" 2>/dev/null \
  || "${FIREBASE[@]}" apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" > "$SCRATCH/sdk.json"

# Keep any values the user already set that Firebase cannot tell us (VAPID key, App Check key).
KEEP_VAPID="$(grep -s '^VITE_FCM_VAPID_KEY=' "$ENV_PROD" | cut -d= -f2- || true)"
KEEP_APPCHECK="$(grep -s '^VITE_APPCHECK_SITE_KEY=' "$ENV_PROD" | cut -d= -f2- || true)"

node - "$SCRATCH/sdk.json" "$ENV_PROD" "$REGION" "$KEEP_VAPID" "$KEEP_APPCHECK" <<'EOF'
const fs = require('node:fs');
const [file, out, region, vapid, appcheck] = process.argv.slice(2);
const raw = fs.readFileSync(file, 'utf8');
let cfg = null;
try { const j = JSON.parse(raw); cfg = j.result?.sdkConfig ?? j.sdkConfig ?? j.result ?? j; } catch { /* not JSON */ }
if (!cfg || !cfg.apiKey) {
  // Fallback: the human-readable output contains a JS object literal with the same keys.
  const pick = (k) => (raw.match(new RegExp(`"?${k}"?\\s*:\\s*"([^"]+)"`)) ?? [])[1];
  cfg = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'),
          storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId'), appId: pick('appId') };
}
const need = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const missing = need.filter((k) => !cfg[k]);
if (missing.length) { console.error('SDK config is missing: ' + missing.join(', ') + '\n' + raw); process.exit(1); }
fs.writeFileSync(out, [
  '# Generated by scripts/deploy-all.sh from Firebase. Public web config, not secrets. Not committed.',
  `VITE_FIREBASE_API_KEY=${cfg.apiKey}`,
  `VITE_FIREBASE_AUTH_DOMAIN=${cfg.authDomain}`,
  `VITE_FIREBASE_PROJECT_ID=${cfg.projectId}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${cfg.storageBucket}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId}`,
  `VITE_FIREBASE_APP_ID=${cfg.appId}`,
  `VITE_FUNCTIONS_REGION=${region}`,
  'VITE_USE_EMULATORS=0',
  `VITE_FCM_VAPID_KEY=${vapid}`,
  `VITE_APPCHECK_SITE_KEY=${appcheck}`,
  '',
].join('\n'));
console.log(`    wrote ${out} for project ${cfg.projectId} (app ${cfg.appId})`);
EOF
[ -n "$KEEP_VAPID" ] || warn "No VITE_FCM_VAPID_KEY: web push stays off (in-app inbox still works). Add it to $ENV_PROD and re-run to enable."

# ---------------------------------------------------------------- 4. env.local
if [ -f "$ENV_LOCAL" ] && grep -q 'VITE_USE_EMULATORS=1' "$ENV_LOCAL"; then
  say "Moving emulator settings ($ENV_LOCAL) aside for the production build"
  mv -f "$ENV_LOCAL" "$ENV_LOCAL_BAK"
fi

# ---------------------------------------------------------------- 5. deploy
say "Deploying Firestore rules, indexes and Storage rules"
"${FIREBASE[@]}" deploy --only firestore:rules,firestore:indexes,storage --project "$PROJECT" --non-interactive

say "Deploying Cloud Functions ($REGION)"
if ! "${FIREBASE[@]}" deploy --only functions --project "$PROJECT" --non-interactive --force; then
  die "Cloud Functions deploy failed. The most common cause is the project not being on the Blaze plan:
  https://console.firebase.google.com/project/$PROJECT/usage/details
Fix that and re-run this script; everything before this step is already done."
fi

say "Building the web app (production preflight)"
npm run build -w "$WEB_DIR"

say "Deploying Hosting"
"${FIREBASE[@]}" deploy --only hosting --project "$PROJECT" --non-interactive

# ---------------------------------------------------------------- 6. verify
SITE_URL="https://$PROJECT.web.app"
say "Verifying the live site: $SITE_URL"
INDEX="$(curl -fsSL "$SITE_URL/?nocache=$(date +%s)" || true)"
[ -n "$INDEX" ] || die "Could not fetch $SITE_URL"
ENTRY="$(printf '%s' "$INDEX" | grep -o 'assets/index-[^"]*\.js' | head -1)"
[ -n "$ENTRY" ] || die "Live index.html has no app bundle; Hosting deploy did not take."
# The app is code-split: fetch the entry bundle and every chunk it references, then search all of it.
ALL="$SCRATCH/live.js"
curl -fsSL "$SITE_URL/$ENTRY" > "$ALL"
SEEN=" $ENTRY "
for _pass in 1 2 3 4; do
  for chunk in $(grep -o '\./[A-Za-z0-9_-]*\.js' "$ALL" | sort -u); do
    name="assets/${chunk#./}"
    case "$SEEN" in *" $name "*) continue ;; esac
    SEEN="$SEEN$name "
    curl -fsSL "$SITE_URL/$name" >> "$ALL" 2>/dev/null || warn "chunk not served: $name"
  done
done
ok=1
for needle in "setProductMostOrdered" "saveCombo" "publicBranches"; do
  if grep -q "$needle" "$ALL"; then echo "    live code contains '$needle'"; else warn "'$needle' NOT found in the live code"; ok=0; fi
done
[ "$ok" = 1 ] || die "The live site is not serving the current code. Check that firebase.json hosting.public is $WEB_DIR/dist and re-run."

cat <<MSG

Deployed $PROJECT successfully.

  Storefront:  $SITE_URL
  Dashboard:   $SITE_URL/business

Where the new features live:
  - Catalog -> edit an item -> "Most ordered" checkbox (or the star on the list row).
  - "Deals & combos" in the dashboard sidebar -> "New combo": pick 2+ items with quantities,
    set the discount %, keep "Promote in the Deals section" on, optionally "Generate promo image", Save.
  - Customers then see the Deals rail with the -N% badge, the "Most ordered" label and the round "+" button.
  - Already-open tabs cache the old app: close and reopen the site (or reload twice) once after a deploy.

Still manual, only if you want them: Authentication -> Sign-in method -> enable Phone (needed for customer
sign-in) and Email/Password (staff); Authentication -> Settings -> SMS region policy -> allow Israel only.
MSG
