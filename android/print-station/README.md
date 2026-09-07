# Qareeb Print Station (Android companion)

A deliberately small Android app whose only job is to be the branch's Bluetooth **print station** for
Classic Bluetooth (SPP/RFCOMM) ESC/POS receipt printers, which browsers cannot reach.

It signs in with the same Firebase email account as the dashboard, verifies branch membership
server-side, lets staff pick an approved branch printer and a **paired** Bluetooth device, and then
runs the shared print queue: claim job → render the validated receipt model with Android's text
stack and the bundled Noto fonts → send ESC/POS raster strips → report a truthful outcome.

## Fonts
The `Noto Sans Hebrew` face bundled here does not include Arabic or Latin glyphs. Android falls back
to its system Noto Sans / Noto Naskh Arabic faces for those scripts, so output remains correct on
stock Android. For pixel-identical output with the web renderer, add `NotoSansArabic-*.ttf` and
`NotoSans-*.ttf` from `assets/fonts` and load them into a `Typeface` fallback chain (API 29+
`FontFamily`), which is left as a documented follow-up.

## Build
Requires Android Studio Ladybug+ / Android SDK 35, JDK 17, and `app/google-services.json`.

```
cd android/print-station
./gradlew assembleDebug        # needs the Gradle wrapper jar; run `gradle wrapper` once with Gradle 8.x
```

To use the Firebase Emulator Suite from an emulator image, set `EMULATOR_HOST` to `10.0.2.2` in
`app/build.gradle.kts` (or your LAN IP for a physical phone) and run the emulators with
`--host 0.0.0.0` in `firebase.json`.

The APK was **not** built in the authoring environment (Android SDK download is blocked there); see
`docs/STATUS.md`.

## Behaviour and limits
- Pairing happens in Android Bluetooth settings; the app only connects to bonded devices.
- Runtime permissions: `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` (Android 12+), notifications.
- A foreground service (`foregroundServiceType="connectedDevice"`) keeps the link and loop alive.
- Printing stops on sign-out, when the heartbeat is refused (membership/station revoked), on
  force-stop, or without connectivity. A disconnected station cannot be revoked instantly; it stops
  when it can no longer refresh authorization.
- Partial transmissions are reported as `partial` and left for staff review — never auto-retried.
- No receipt content is written to disk; models live in memory for the duration of the job.
