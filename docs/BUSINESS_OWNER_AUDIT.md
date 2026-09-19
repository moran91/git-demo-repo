# Business-owner usability and location audit

Reviewed 19–20 September 2026. Changes are local; nothing was deployed.

## Scope

Reviewed owner sign-in, registration, password reset, email verification, invitations, business selection,
new-business/new-branch setup, incoming orders, history, order details, catalog, shared extras, combos,
promotions, branch settings, business profile, staff, loyalty, cash records, printers, and QR links.
Customer discovery and address forms were included for the requested location features.

The browser sweep covers 12 owner sections in Hebrew, Arabic, and English, at 390px and 1440px widths.
It checks rendered pages for runtime errors, unexpected error messages, and horizontal overflow.
Focused interaction tests cover the workflows below. This is a software review, not a usability study
with older participants or a claim that every possible defect has been eliminated.

## Changes for first-time and older users

- Owner pages use larger text, 52px form controls, and at least 48px primary button/icon targets.
  Mobile layouts wrap actions and show order history as readable cards.
- The mobile Menu button has a visible label. Its native dialog traps keyboard focus, supports Escape,
  locks background scrolling, and returns focus to the opener.
- A dismissible getting-started guide links to branch setup, catalog, and customer preview.
- Forms initially show one language and explain that one translation is enough. Other translations,
  descriptions, and advanced product settings can be expanded when needed.
- Branch/profile forms show unsaved/saved state. The branch Save control stays visible while scrolling;
  validation summaries receive focus and scroll into view.
- Tracked drafts warn before route changes, browser Back, dialog closure, and page reload. Incoming
  branch updates, including pausing orders, no longer erase a settings draft.
- Branch switches retain the current section. Long branch names remain readable on phones.
- Pause has a confirmation explaining its effect. The displayed opening status reflects actual hours,
  approval, suspension, and pause state.

## Functional corrections

| Area | Correction |
| --- | --- |
| Authentication | Wait for memberships before deciding access; fence stale token callbacks; expose membership load failures. Phone customers can switch to an owner email account without a redirect loop. |
| Account recovery | Password reveal controls, native email/required validation, trimmed name validation, honest reset errors, verification retry/sign-out, and wrong-account invitation recovery. |
| Catalog | A newly saved product retains its ID and enables its photo control; subsequent saves update that product. Normalize null optional fields returned by callables before revalidation. Keep failed edits open, validate stock, search all translations, and prevent additions to archived categories. |
| Hours and delivery | Recalculate overnight times when either end changes; reject overlapping intervals and duplicate special dates; preserve special-day intervals. New branches start with delivery off. Delivery needs a service area. Copy-to-all-days requires confirmation. |
| Map removal | Clearing a branch pin removes both stored coordinates and updates the public branch projection. Previously the old pin survived the save. |
| Combos and media | Selecting a size no longer silently adds an item. Keep save/upload operations busy until complete and protect edited drafts. |
| Orders | Show acceptance/rejection feedback and actionable loading failures. Sound is enabled only after a successful user gesture. Reset/fence history pagination when filters change. Restrict combo revisions to supported operations. |
| Staff, loyalty, cash | Load staff in an effect with retry, clear stale invitation links, gate financial queries by role, translate history labels, enforce redemption bounds, and label cash totals as the latest 100 records. |
| Printing | Surface preview/job errors, choose the OS print option when Bluetooth is unavailable, and initialize receipt language from the current locale. |
| Shared infrastructure | Prevent old document/collection results appearing after navigation. Fix an existing conditional hook in admin routing. Use the router's navigation blocker for owner draft protection. |

## Location behavior

Customers can explicitly choose **Use my location**. After browser permission, discovery selects the
nearest active supported town within 25km of its configured centre. This is an approximation using
town centres, not municipal boundary lookup. Positions with reported accuracy worse than 5km are
rejected. Permission refusal, timeout, unavailable location, and positions outside the service area
have recovery messages and allow manual selection.

The preference remembers opt-in and town ID. Returning users refresh automatically only when the
browser already grants location permission. Choosing a town manually disables automatic selection;
late location callbacks cannot override that choice. Discovery does not persist raw GPS coordinates.
Existing carts and saved addresses are not rewritten by discovery location detection.

Customer addresses and business branches now use a map instead of coordinate text entry. Users can
tap to place a pin, drag it, use their current location, or pan with the keyboard and select the map
centre. Cancel preserves the form; confirmation selects the point; the normal form Save persists it.
An explicitly saved address or branch pin does store its coordinates. Pins can also be removed.

The map is loaded on demand with Leaflet. Tiles come from `VITE_MAP_TILE_URL` (a keyed provider in
deployments); without it the picker falls back to tile.openstreetmap.org, which the OSMF policy allows for
development only. Attribution remains visible, only
visible tiles are requested, and normal browser caching applies. Maps require network access; tile
failures offer Retry. Manual address descriptions remain available without a pin. Implementation was
checked against the [Leaflet quick start](https://leafletjs.com/examples/quick-start/) and
[OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Verification

- Shared domain tests: 55 passed, including four nearest-town tests.
- Functions integration tests: 36 passed against local Firebase emulators.
- Firestore/Storage rules tests: 15 passed.
- Browser coverage: 31 distinct scenarios passed across the main run and targeted reruns. This
  includes the 72 owner-page combinations, customer checkout, manager acceptance, staff restrictions,
  product creation/update/upload/customer photo zoom, branch creation, draft protection, and nine
  location/map scenarios. Targeted reruns corrected stale test labels/seed assumptions and matched
  the local web server's storage bucket to the emulator (`qareeb-dev.firebasestorage.app`).
- All-workspace type checking and the final production build passed. Lint finished with zero errors
  and 24 warnings. `git diff --check` passed.
- A real mobile map render loaded six OpenStreetMap tiles and displayed the selected pin without errors.
- Dependency audit reported no vulnerabilities after adding Leaflet.

Browser tests use installed Google Chrome and local Firebase emulators, with fictional seeded data.
An earlier run exhausted disk space while writing Playwright traces; the reruns used `--trace off`.
The machine runs Node 26.5.0; the repository declares Node 22. Production-runtime parity still needs
the project's normal Node 22 CI checks. Bluetooth printer hardware, real SMS/push delivery, Android,
and production deployment were not tested in this pass.
