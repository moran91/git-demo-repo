# Business QR codes and deep links

Owners generate a QR code from the dashboard (**QR code** in the sidebar, `settings` permission) that
opens their storefront when scanned. This document is the contract the web app and the future
Android / iOS apps share; the code lives in `packages/shared/src/links.ts`.

## Link format

| Form | Opens |
|---|---|
| `https://<origin>/q/<businessId>` | Business; the storefront picks the first visible branch |
| `https://<origin>/q/<businessId>/<branchId>` | That branch directly |

- Ids are Firestore document ids (`[A-Za-z0-9_-]{1,64}`). Anything else is rejected at generation
  time and gets the normal 404 when scanned.
- `/q/` is reserved for scanned links. The web app (`apps/web/src/customer/QrLanding.tsx`) validates
  and redirects to the storefront at `/b/<businessId>[/<branchId>]`. Storefront links are never
  encoded directly so that native apps can claim the `/q/*` path alone, and so scan analytics can be
  added in one place later.
- Codes are printed and stuck on windows: **never remove an accepted form**, only add new ones.
- The origin comes from `VITE_PUBLIC_ORIGIN` when set, otherwise `window.location.origin`, so a
  staging build can be pointed at the production domain when printing real stickers.

## Generation

Client-side with the `qrcode` package, error-correction level M, quiet zone 2 modules, black on
white. Nothing is stored server-side; the dashboard offers PNG (1024 px), SVG, a printable A4 poster
(`.qr-print`, printed through the same `@media print` rules as receipts) and copy-link.

## Native apps (to do when the apps exist)

1. Android: serve `/.well-known/assetlinks.json` from Hosting with the app's package name and
   signing-cert SHA-256, and declare an `intent-filter` with `android:autoVerify="true"` for
   `https://<origin>/q/…` (path prefix `/q/`).
2. iOS: serve `/.well-known/apple-app-site-association` (`firebase.json` already sends it as
   `application/json`) with `"paths": ["/q/*"]`, and add the `applinks:<origin>` associated domain.
3. In the app, run the received URL through the same rules as `parseBusinessQrLink`: `null` means
   "not a business link", open it in the browser; otherwise navigate to the business/branch screen.
4. Camera scanning inside the app should accept the same URLs, so a sticker scanned with the phone
   camera and one scanned from within the app behave identically.
