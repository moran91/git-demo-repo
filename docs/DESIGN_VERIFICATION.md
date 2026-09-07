# Design verification note

Captures in `docs/screenshots/` were produced by `e2e/screenshots.spec.ts` against the emulator seed
(Chromium, Asia/Jerusalem, full-page). Naming: `<screen>-<locale>-<width>.png` for discovery, business
detail, product options, checkout, address form, order detail (customer), and `dash-*` / `admin-*` for the
dashboards at 390 and 1440.

Note on full-page captures: fixed elements (bottom navigation, cart bar, bottom sheets) are painted at the
viewport position inside the tall image, so they appear "mid-page" in some captures; in the live app they
stay pinned to the viewport and never cover content (padding accounts for `--bottom-nav-height` and
safe-area insets).

## Checked against the visual specification
| Item | Result |
|---|---|
| Tokens: #FAF7F0 background, #FFFEFA surfaces, #193E2D text, #20583B primary, #EDF2E4 soft/selected, #E4E7DC borders, warm accent #924220/#FBE5D5, danger #A3342B/#FDEDE9 | Defined once in `apps/web/src/design/tokens.css`; all components use the tokens |
| Wordmark "qareeb" + leaf mark as a real SVG asset with translated label; PWA icons generated from the same mark | Header and dashboards; `public/icons/*` |
| Noto Sans Hebrew / Arabic / Latin self-hosted, weights 400/500/600, no letter-spacing on he/ar | `@font-face` with unicode-range in `base.css`; `letter-spacing: normal` globally |
| Type scale: body 16 / secondary 14 / badge 12 / heading 20 / headline 28→36→40 | tokens + media queries |
| 4-px spacing, gutters 20 → 16 (≤360) → 32 (≥768) | `--gutter` |
| Radii: cards 16, controls 12, segmented 14, badges 6 | tokens |
| Buttons ≥48 px, icon buttons ≥44 px, persistent labels, secondary = near-white + border, destructive distinct | `Button`, `IconButton`, `Field` |
| Discovery order: header + language → tappable city pin → compact headline/subtitle → pickup/delivery + restaurants/supermarkets segmented → "Around your neighborhood" cards → bottom nav (+ cart summary when items) | discovery-*-360/390/768/1440 |
| Cards: cover area (16:9, branded fallback), name, branch, open/closed badge with label, delivery fee, minimum, pickup, favourite heart; metadata wraps | discovery-*; long Hebrew/Arabic names wrap, no clipping |
| Business detail: cover, name, branch selector, open state, phone, sticky category chips, square product images, explicit prices/units, add action | business-* |
| Options: bottom sheet on mobile / dialog on desktop, required indicators, min/max, notes, live price on the add button, long content scrolls under a fixed footer | product-options-* |
| Address: "Your house, in your words." headline, soft-green block with house icon, ≥110 px textarea first, city/recipient/phone after, optional conventional fields grouped in a disclosure and labelled optional, Save address | address-form-* |
| Checkout: items, delivery fee, loyalty discount, cash due, "Cash on delivery/pickup", estimated vs final labelling, Place order; validation errors adjacent (below-minimum case captured) | checkout-* |
| Order detail: real reference, one of three statuses, Call business; no timeline | order-detail-en-390 / 1440 |
| Dashboard: sidebar (desktop) / drawer (mobile), business + branch switchers, pause control, incoming cards with reference, Placed label, time, customer, items, house block, cash total, Accept/Reject side by side, Print order, phone | dash-orders-* |
| Printers: settings, connection indicator, queue with explicit states, OS-dialog explanation | dash-printers-* |
| Admin: sidebar layout, pending approvals table with reason dialog, metrics note ("acceptance is not revenue") | admin-approvals-* |
| RTL: `dir` on root, logical properties, mirrored directional icons only, numbers/phones/references isolated with `<bdi>` / `.num` | he/ar captures; English within RTL pages renders LTR |
| Focus, dialogs, reduced motion | native `<dialog>` (focus trap + Escape + restore), `:focus-visible` ring, `--duration: 0` under `prefers-reduced-motion` |

## Fixed during review
- English text inside RTL receipts/rows was rendered with RTL punctuation order → per-line direction detection in the raster renderer.
- Limited managers/staff saw an empty branch list because list queries could not be proven by the membership rules → per-document reads for limited memberships and `businessId` filters on every dashboard query (with matching composite indexes).
- Native `<dialog>` elements kept in the DOM while closed confused accessibility queries → dialogs mount only while open.
- Empty order-summary card when the quote fails validation → hidden until a quote exists.

## Known visual limitations
- Seed businesses have no photos, so cards show the branded fallback; production uses owner uploads.
- Product favourites list shows product IDs (business favourites are fully rendered).
- Dark mode palette is defined but not exposed as a toggle (optional for launch).
