# Bluetooth receipt printing — design, verification and handover

## Status in one paragraph
The complete printing subsystem is implemented and tested with a **simulator** (raster fixtures and
encoded bytes): receipt model, shaped Hebrew/Arabic/English raster rendering, ESC/POS encoding,
Web Bluetooth BLE transport with documented profiles, Android RFCOMM station (source), server-side
job queue with leases/fences, automatic-print policy, duplicate/reprint coordination, and recovery
states. **No physical printer has been tested**: the launch printer make/model was not provided and
the authoring environment has no Bluetooth hardware. Bluetooth printing must not be declared verified
until the checklist at the end passes on the intended device.

## Pipeline
```
order/test → buildOrderReceipt() / buildTestReceipt()  (packages/shared/src/receipt/model.ts)
          → immutable ReceiptModel JSON stored on printJobs/{id}.receipt (server, enqueuePrint / auto)
          → station claims job (lease + fence) → renderReceipt() to 1-bit bitmap using Noto fonts
          → encodeReceipt(): ESC @, GS v 0 raster strips (≤ maxStripRows each), ESC d feed, GS V cut
          → transport: BLE GATT writes (chunk + pacing per profile) | RFCOMM socket (Android)
          → reportPrintAttempt(): sent | failed_before_send | partial  → job state
```
Text is **never** sent as raw ESC/POS codepage text; every receipt is shaped by the platform text
engine (browser canvas / Android StaticLayout) and printed as pixels, so Hebrew/Arabic joining and
bidi are correct regardless of printer fonts. Cash-drawer commands are never emitted (unit-tested).

## Templates
- **Order ticket** (kitchen/counter): business + branch + phone, large reference, PICKUP / DELIVERY,
  status snapshot ("Awaiting acceptance — not yet accepted" for placed orders; "REJECTED — do not
  prepare" when printed manually for rejected orders), customer name/phone, then for delivery the
  **house description in a bordered box before any conventional address field**, items with modifiers,
  notes, requested/actual weights, removed/replacement labels, totals, "Cash on pickup/delivery" or
  "Cash received" (only when a cash record exists), "Order summary — not a tax invoice". Copies and
  revisions carry `*** COPY ***` / `*** REVISED ***`.
- **Customer copy**: same model, template flag `customer_copy`.
- **Test receipt**: Hebrew, Arabic, English lines, mixed-direction rows with phone numbers and ₪ amounts,
  a long village house description in all three languages, paper/dots/locale footer.

Fixtures rendered by `packages/shared/test/receipt.test.ts` are committed under `docs/print-fixtures/`
(PNG + PBM) for 58mm/384 dots and 80mm/576 dots in he/ar/en. They are labelled **SIMULATION**.

## Printer profiles (`packages/shared/src/receipt/profiles.ts`)
| Profile | Transport | Service / char UUIDs | Write mode | Chunk / pacing | Raster | Verified |
|---|---|---|---|---|---|---|
| generic_escpos_ble_ff00 | Web Bluetooth BLE | 000018F0 / 00002AF1 (notify 2AF0) | without response | 100 B / 20 ms | GS v 0, 128-row strips | **No (candidate)** |
| generic_escpos_ble_ff00_alt | Web Bluetooth BLE | 0000FF00 / 0000FF02 (notify FF01) | without response | 100 B / 20 ms | GS v 0 | **No (candidate)** |
| generic_escpos_ble_e7810a71 | Web Bluetooth BLE | E7810A71-… / BEF8D6C9-… | with response | 180 B / 10 ms | GS v 0, cut | **No (candidate)** |
| classic_escpos_rfcomm | Android station (SPP) | SPP 00001101-… | stream | 512 B | GS v 0, 256-row strips | **No (candidate)** |
| classic_escpos_rfcomm_escstar | Android station (SPP) | SPP | stream | 512 B | ESC * 24-dot fallback | **No (candidate)** |
| os_print_dialog | OS printing stack | — | — | — | HTML layout | Yes (not Bluetooth) |

A profile becomes "verified" only after the physical checklist below passes; record the result in the
table and set `verified: true` in code.

## Platform support matrix
| Client | Direct Bluetooth | Path |
|---|---|---|
| Chrome/Edge on Android, ChromeOS, Windows, macOS (secure context) | BLE only, documented profiles | Web Bluetooth station in the dashboard (`/printers`) |
| iPhone/iPad Safari or PWA | **No** (Web Bluetooth not exposed) | Send jobs to the branch's Android station; or OS print dialog / AirPrint-capable printers (not Bluetooth) |
| Any browser | — | Print dialog / Save as PDF fallback (OS printing stack; dismissed dialog never counts as printed) |
| Android companion app | Classic Bluetooth SPP/RFCOMM | `android/print-station` (foreground service) |
| Future native iOS app | Vendor SDK / MFi accessory or Core Bluetooth for the actual hardware | Not built |

References: https://developer.chrome.com/docs/capabilities/bluetooth ·
https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices ·
https://developer.android.com/develop/connectivity/bluetooth/bt-permissions ·
https://developer.apple.com/documentation/externalaccessory · https://developer.apple.com/documentation/corebluetooth ·
https://developer.apple.com/documentation/uikit/uiprintinteractioncontroller

## Job lifecycle and guarantees
- **Keys**: automatic jobs use `orderId:revision:trigger:printerRole:template:copyIndex` → duplicate
  triggers collapse; manual first copies are refused with `duplicate_copy` while a matching copy is
  queued/sent; `reprint=true` (+ reason) creates a labelled COPY job.
- **Lease/fence**: `claimPrintJob` sets `sending`, a 90 s lease and an incremented fence. Reports with a
  stale fence are rejected (`version_conflict`), so a crashed/superseded worker cannot mutate the job.
- **States**: `queued → sending → sent_unconfirmed → confirmed` (staff/printer confirmation);
  `failed_before_send` re-queues up to 3 attempts then `needs_review`; `partial` and expired leases →
  `needs_review` with a branch notification; staff resolve with **It printed / It did not print / Retry**.
  A successful write proves transmission only, never paper output.
- **Backlog**: stations auto-claim only jobs younger than 10 minutes; older jobs are listed under "Older
  unprinted jobs" for explicit selection or skipping — reconnecting never dumps a stale backlog.
- **Isolation**: printing never accepts orders, records cash or touches loyalty. Printer settings are
  owner/manager only; staff can print/reprint. Stations are bound to printers/branches, revocable, and
  stop when heartbeats are refused.
- **Privacy**: receipt models live in Firestore under branch-member read rules; no Storage links, no push
  payloads, no service-worker caches, no local spool on Android.

## Shop setup (plain language)
1. Sign in to the dashboard as owner/manager → **Printers** → **Add printer**: name, connection type,
   profile, paper (58/80 mm), printable dots (384/576 typical), receipt language, copies, role.
2. Web BLE: on the phone/tablet that will sit next to the printer, tap **Connect printer**, choose the
   device in the browser dialog. Android Classic: install the companion, sign in, pick branch printer +
   paired device, **Start print station**.
3. **Test print** → check on paper: Hebrew, Arabic, English, numbers/phones, ₪, the long address → then
   **Confirm the test receipt printed correctly** (setup verified).
4. Optionally set **Automatic printing** to "When placed" or "When accepted" (one station per role).
   Manual **Print order** is always available on incoming cards and order detail.
5. Recovery: the queue shows each job's state; "Needs review" jobs require an explicit decision;
   **Reprint** creates a labelled copy; iPhone users send jobs to the Android station.

## Physical test checklist (required before "verified")
Record: printer make/model, firmware, profile used, paper width, printable dots, OS + version,
browser/companion version, transport, date, tester.
1. Test receipt 58 mm and/or 80 mm: all three scripts legible, joined Arabic, correct RTL order, ₪, phone
   numbers not mirrored, long address wrapped, no clipped right/left edges, feed/cut as configured.
2. Newly placed delivery order with village directions prints; the order stays **placed** afterwards.
3. Manual print then a second manual print → duplicate warning; Reprint → COPY label.
4. Revised order reprint → REVISED label with original vs revised totals.
5. Two devices registered as station for one printer → only the active one prints; take-over works.
6. Pull power/turn off Bluetooth mid-print → job becomes needs_review; staff confirm/cancel/retry; no
   duplicate ticket without explicit action.
7. Disconnected station → jobs wait as queued; reconnect after 15 minutes → older jobs are offered for
   selection, not auto-printed.
8. Revoke the staff membership → station stops within the heartbeat interval.

## Still needed from the business
- Intended printer brand/model (and whether it is BLE, Classic Bluetooth, or both), firmware/version.
- Shop device: Android version (and Chrome version) or iPhone/iPad iOS version.
- Paper width in use (58 or 80 mm).
