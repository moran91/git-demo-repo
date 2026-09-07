#!/usr/bin/env bash
# Starts the Firebase Emulator Suite for local development/tests.
# Proxy variables are cleared for the emulator process only: firebase-tools routes its own
# localhost trigger-registration calls through HTTPS_PROXY when set, which breaks in sandboxed CI.
set -euo pipefail
cd "$(dirname "$0")/.."
export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$HOME/.cache/firebase/emulators}"
exec env -u HTTPS_PROXY -u https_proxy -u GLOBAL_AGENT_HTTPS_PROXY -u HTTP_PROXY -u http_proxy \
  firebase emulators:start --only auth,firestore,functions,storage --project "${FIREBASE_PROJECT:-qareeb-dev}" "$@"
