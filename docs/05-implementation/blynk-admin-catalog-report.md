# Blynk Admin/Ops — Catalog, Product Images & Home Promotions

**Admin scope:** Products, Categories and Promotions (plus a Dashboard that
summarises them). Inventory and Rider are **separate future applications**,
not Admin modules — see §11.

Status labels: **IMPLEMENTED** (code exists), **TESTED** (automated tests),
**LIVE VERIFIED** (run end to end against the real backend and PostgreSQL),
**UNVERIFIED** (not confirmed).

---

## 1. Architecture

Nothing was forked or duplicated. One backend, one database, two
interfaces:

```
              BLYNK BACKEND (Node + TypeScript, Express, Kysely)
                                 │
                        PostgreSQL (one database)
                                 │
        ┌────────────────┬───────┴────────┬────────────────┐
        ▼                ▼                ▼                ▼
   CUSTOMER APP      ADMIN APP      INVENTORY APP      RIDER APP
   apps/customer     apps/admin    (separate app,    (separate app,
                                      next phase)        later)
     (Flutter)     (React+Vite+TS)
```

Four separate interfaces with different users and permissions, all talking
to the same API and the same database. They are **not** modules of one
another: Admin contains no Inventory or Rider navigation, not even disabled
placeholders, and nothing in Admin writes to those domains.

- **New:** `apps/admin` — there was no web app in the repository before, so
  one was created with React + Vite + TypeScript (the stack the brief's
  architecture diagram names). No UI framework or component library was
  added; the styling is plain CSS with the Blynk tokens.
- **Reused as-is:** authentication, RBAC middleware, the catalog module,
  pricing, the customer `ProductProvider`, the carousel widget's place in
  Home, the customer design tokens.
- **Backend additions (this phase):** a `promotions` module, an admin media
  upload endpoint, a storage abstraction, and one admin product-list
  endpoint (see §7).

## 2. Authentication & RBAC (IMPLEMENTED, TESTED, LIVE VERIFIED)

The admin app signs in through the **existing customer OTP flow** —
`POST /auth/otp/request` then `/auth/otp/verify` — and then requires
`user.role === 'ADMIN'`; any other role is signed straight back out.

That check is a courtesy for the operator. **Authorization is enforced
server side on every admin route** by the existing
`requireAuth` + `requireRoles('ADMIN')` middleware, so knowing an endpoint
gets a customer nowhere:

| Attempt | Result |
|---|---|
| Anonymous `POST /admin/promotions` | 401 `UNAUTHORIZED` |
| Customer token on create/list/update/reorder/delete promotion | 403 `FORBIDDEN` |
| Customer token on `POST /admin/media` (upload) | 403 `FORBIDDEN` |
| Customer token on `DELETE /admin/media` | 403 `FORBIDDEN` |
| Customer token on admin product/category routes | 403 (pre-existing, unchanged) |

No secret is present in the admin bundle: the only build-time variable is
`VITE_API_BASE_URL`, and the session token comes from the operator's own
login.

## 3. Product management (IMPLEMENTED, TESTED, LIVE VERIFIED)

Screens: product table, add product, edit product.

- Fields come from the **existing** backend product schema: category, name,
  SKU, barcode, unit, pack size, description, image, purchase cost, custom
  markup %, available, active. No database field was invented.
- **Stock tracking is not here.** `tracking_mode` turned out to live on the
  `inventory` table, not on `products` - the product create/update schema
  silently ignored it. The control has been removed: it did nothing, and
  stock tracking belongs to the Inventory application.
- **Pricing stays a backend calculation.** The form shows a preview of
  `purchase_cost × (1 + markup/100)`, clearly labelled as a preview; the
  stored and customer-visible price is whatever the backend computes
  (`calculated_selling_price`). The live test asserts 400 + 25 % → 500 and
  600 + 25 % → 750.
- **Cost and markup never reach customers.** The customer DTO
  (`CustomerProductDto`) already strips them, and this phase did not widen
  it.
- **Table:** image, product (name + SKU + unit), category, selling price,
  status, updated, actions. Search (name/SKU/barcode),
  category filter, active/inactive filter, edit, enable/disable with a
  confirmation dialog.

### Active / inactive

Uses the **existing soft-disable semantics**: `is_active` on the product
row. The customer catalog query already filters `is_active = true`, so
disabling hides a product from customers immediately while leaving the row —
and every historical order line that references it — intact. **No delete
endpoint was added**, because none exists and none is needed for this.

## 4. Product & promotion images (IMPLEMENTED, TESTED, LIVE VERIFIED)

### Storage decision

The repository had **no object storage**: the API talks to its own
PostgreSQL and nothing else, and the Supabase containers in the compose file
are not wired into this backend. Rather than silently adopting a
third-party service, this phase added the smallest production-appropriate
abstraction:

- `utils/storage.ts` defines a `MediaStorage` interface (`save`, `delete`,
  `keyFromUrl`) with a `LocalDiskStorage` implementation. Swapping in
  S3/GCS/Supabase later means adding one class, not touching the modules.
- Files are written under `MEDIA_ROOT` (default `uploads/`) and served by
  Express at `/uploads` with a 7-day cache.
- **The database stores the URL only** — no image bytes in PostgreSQL.
- `PUBLIC_BASE_URL` makes the stored URL absolute, so the Flutter app never
  hardcodes a host.

### Upload pipeline

```
admin picks file → validated (type, size) → downscaled to ≤1200 px WebP in
the browser → POST /admin/media (multipart, ADMIN only) → magic-number
sniff → written to disk → URL returned → saved on the product/promotion
```

- Accepted: JPEG, PNG, WebP. Cap: **2 MB** at the API, 12 MB at the picker
  before downscaling.
- **The declared content type is not trusted.** The file's magic number
  decides; a PHP payload renamed `evil.png` with `Content-Type: image/png`
  is rejected with 400. (My first implementation fell back to the declared
  type — the test caught it.)
- Folders are restricted to `products` and `promotions`; a traversal
  attempt like `../secrets` is rejected.
- Admin UI supports preview before save, replace, and remove; removing also
  deletes the stored file, as does deleting a promotion.
- Aspect ratio is preserved on downscale (longest edge capped).

## 5. Categories (IMPLEMENTED, TESTED)

The backend supports **create and update only** — there is no category
delete endpoint. The admin screen therefore offers add, edit, and
activate/deactivate, and says so on the page. Nothing fake is shown.
Customer Home, Categories and Search continue to read the same real
categories.

## 6. Home promotions (IMPLEMENTED, TESTED, LIVE VERIFIED)

### Data model — `promotions` table (migrations `004_promotions.sql`, `005_promotion_backgrounds.sql`)

| Column | Notes |
|---|---|
| `id` | uuid |
| `title` | required, ≤120 |
| `subtitle` | optional, ≤240 |
| `image_url` | optional foreground visual; URL only |
| `background_type` | `SOLID` / `GRADIENT` / `IMAGE`, default `SOLID` (migration 005) |
| `background_color` | hex; solid colour, or gradient start |
| `background_color_end` | hex; gradient end |
| `background_image_url` | background photo; URL only |
| `cta_label` | optional |
| `cta_destination_type` | `CATEGORY` / `PRODUCT` / `CATALOG`, or null |
| `cta_destination_value` | category slug or product id |
| `display_order` | customer ordering |
| `is_active` | customer visibility |
| `created_at`, `updated_at` | bookkeeping |

**Start/end scheduling was deliberately not modelled.** Promotions are
switched on and off by hand today; an unused scheduler would add a code
path nothing exercises. It is a one-column-pair migration if that changes.

### API

| Route | Who | Purpose |
|---|---|---|
| `GET /api/v1/promotions` | public | active promotions, display order — what Home renders |
| `GET /api/v1/admin/promotions` | ADMIN | all promotions, optional `is_active` filter |
| `POST /api/v1/admin/promotions` | ADMIN | create |
| `PATCH /api/v1/admin/promotions/:id` | ADMIN | edit / activate / deactivate |
| `PATCH /api/v1/admin/promotions/reorder` | ADMIN | bulk display order, one transaction |
| `DELETE /api/v1/admin/promotions/:id` | ADMIN | delete (also removes its foreground and background files) |

The customer payload carries no `is_active`, `created_at` or `updated_at` —
asserted by a test.

### Destinations

A promotion may point at a **category** (existing `/products` route with a
slug), a **product** (existing `/product` route), the **whole catalog**, or
nothing at all. A promotion with no destination simply renders without a
button — no fake destination is invented. Cross-field validation refuses a
destination without its value or label, on create and on partial update.

## 6b. Promotion background control (IMPLEMENTED, TESTED, LIVE VERIFIED)

Before this, a promotion had one image field and the Flutter carousel chose
its own tint from a palette it rotated through — the operator had no say in
how a card looked. Now the admin controls the whole composition, using the
existing promotion record and the existing media pipeline (nothing
duplicated).

**Database — `005_promotion_backgrounds.sql`** (with a `_down` file): four
columns on `promotions` (table in §6). `background_type` has a `CHECK`
constraint and defaults to `SOLID`, so existing rows stay valid.

**Validation (zod, create and partial update):**
- colours must be hex (`#RGB`, `#RRGGBB` or `#RRGGBBAA`);
- `GRADIENT` needs both colours; `IMAGE` needs `background_image_url`;
- on `PATCH` the service validates the **merged** row, so switching an
  existing promotion to `GRADIENT` without colours is refused (400) even
  though each field is individually optional;
- replacing or clearing a background image deletes the old file.

**Admin editor** — the promotion dialog is split into the sections an
operator thinks in, with no raw CSS or developer controls:

| Section | Contents |
|---|---|
| Content | headline, supporting text, CTA label + destination |
| Foreground visual | optional product/campaign image (existing uploader) |
| Background | segmented **Solid / Gradient / Image**. Solid: 7 named swatches (Blynk Yellow, Butter, Warm sand, Leaf, Blynk Green, Ink, Cloud). Gradient: 5 named presets (Sunrise, Market morning, Fresh, Midnight, Paper). Image: the existing uploader, `promotions` folder |
| Customer preview | `PromotionPreview` — the carousel's composition (background, headline, subtitle, CTA, foreground), updated live |
| Settings | active, display order |

The payload nulls the fields the chosen type doesn't use, so switching from
Image to Solid never leaves a stale URL behind. The table's Background
column names what is set ("Blynk Yellow", "Gradient", "Image") beside a
compact card preview.

**Customer rendering** (`home_screen_carousel.dart`, `PromotionModel`):
- the carousel has **no palette of its own** any more; it paints exactly
  what the API sends;
- `SOLID` → flat colour; `GRADIENT` → linear gradient; `IMAGE` → cover
  photo under a dark left-to-right scrim so the words stay legible;
- text colour follows the background: luminance below 0.45 (or any image
  background) switches the headline, subtitle and CTA to their light form;
- an unparseable colour falls back to the neutral surface; a background
  image that fails to load falls back to the same surface (the scrim keeps
  the text readable);
- **no foreground image → no empty frame.** The earlier placeholder box is
  gone; the background carries the card on its own. A foreground image that
  fails to load also renders nothing;
- no promotions → the carousel is not rendered at all.

**Verified live:** created a GRADIENT promotion (Market morning) in Edge,
saw the gradient swatch and "Gradient" in the table, and saw the same
gradient with headline, subtitle and a yellow "Shop Dairy" CTA on customer
Home. A foreground PNG was layered on and then removed. Phone (~324 px) and
tablet captures were reviewed: headline wraps, CTA fits, no overflow; the
narrowest layout drops the subtitle. After the promotion was hidden, Home
rendered with no carousel and no gap.

## 7. Customer integration (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **`ProductProvider.loadPromotions()`** (the existing provider, not a new
  one) fetches `/promotions`.
- **The carousel now has no content of its own.** The previous version
  carried three hardcoded campaigns and bundled product photography from the
  original template; that is gone. It renders the API's promotions in the
  API's order.
- **No promotions, or a failed request → the carousel renders nothing** and
  the rest of Home is unaffected.
- **A promotion without a foreground image** composes on its background
  alone (see §6b); a broken foreground URL renders nothing rather than a
  broken-image box.
- **Product images**: the customer app already rendered `image_url` through
  the shared `ProductImage`, so an admin upload flows to product cards,
  Product Details, search results and cart rows with no Flutter change.
- Only one promotion → no pagination track; more than one → pill indicator,
  swipe, and 6-second auto-advance (paused while Home is under another
  route).

## 8. API & database changes

**Database:** one new table (`promotions`) plus its index (migration 004),
then four background columns on that same table (migration 005). Both have
down migrations. No pre-existing table was altered.

**New endpoints:** the six promotion routes above, `POST`/`DELETE
/admin/media`, and **`GET /admin/products`**.

That last one closed a real gap: the only product listing was the customer
catalog, which is active-only, so an operator could never find a disabled
product to re-enable. It reuses the existing `v_product_catalog` view and
the same numeric normalization as `GET /admin/products/:id`.

**Untouched:** inventory, riders, deliveries, orders, payments, pricing,
auth and users modules.

## 9. Testing

Latest full run, after the background control, visual refinement and logo
change:

| Suite | Result |
|---|---|
| Backend `tsc --noEmit` | clean |
| Backend full suite (`vitest`) | **292 passing**, 13 files |
| Admin `tsc`, `vitest`, `vite build` | clean · **10 passing** · built |
| Flutter `flutter test` | **167 passing** |
| Flutter `flutter analyze` | 2 infos, both pre-existing (`use_build_context_synchronously`) |

**Backend — `backend/api/tests/promotions.test.ts`, 23 tests** (real
Express app + real PostgreSQL): anonymous 401; customer 403 on all five
promotion routes and both media routes; create/update/delete; 404 for a
missing promotion; CTA cross-field validation; customer list is active-only
and ordered; reorder reflected; no bookkeeping fields leaked; upload stores
and serves a file; non-image rejected; renamed payload rejected; bad folder
rejected; delete removes the file. **Seven are new for backgrounds:** a new
promotion defaults to SOLID with no colour; a solid colour is stored; a
gradient is stored and needs both colours; an image background needs an
image; a non-hex colour is rejected; a partial update is validated against
the merged row; the background reaches the customer endpoint.

**Admin app — `apps/admin/src/test/admin.test.tsx`, 10 tests**: ADMIN login
stores the session; a CUSTOMER account is refused and no token is kept; API
errors are surfaced, not technical ones; the promotions table shows status
(Live/Hidden), destination and the named background ("Blynk Yellow",
"Gradient"); reorder sends the correct swapped payload; Show sends
`{is_active: true}`; delete asks first; image validation; and an
**admin-scope test** — exactly four navigation links, and no Inventory,
Rider, supplier, stock, delivery or "coming later" text anywhere in the
shell.

**Customer app — `test/home_carousel_test.dart`, 23 tests**: renders what
the API returned; no hardcoded campaign survives; order follows the API;
empty list and failed request both hide the carousel; single promotion has
no pagination; auto-advance; swipe; CTA routes; informational promotion has
no button; six viewport sizes without overflow; and the
**admin-controlled background** group — solid renders `#FFE141`, gradient
renders `#0C831F → #5FBF6E`, image background renders, an unparseable colour
falls back, and the carousel applies no palette of its own. A promotion
without a foreground image still composes.

**Live E2E — `integration_test/admin_to_customer_flow_test.dart`** (real
backend, real database, no mocks), passing (41 s):

1. admin OTP login as the seeded ADMIN account
2. anonymous admin API call → 401
3. upload product image → create product (price calculated 400 + 25 % = 500)
4. upload promotion visual → create two promotions with GRADIENT backgrounds, orders 1 and 2
5. customer catalog contains the product **with its image URL**; search finds it
6. admin edits name and cost → customer sees the new name and **750**
7. the gradient reaches the customer payload; admin PATCHes to an IMAGE background → customer receives `IMAGE`; an invalid gradient → 400
8. Home carousel shows the promotions **in the admin's order** (either title may be on screen, because auto-advance runs in real time)
9. admin reorders → the customer carousel follows
10. admin deactivates one → it disappears from the customer app
11. admin disables the product → it leaves the customer catalog
12. cleanup, then: no active promotions → **carousel hidden entirely**

The E2E was last run before the logo change, which touched only static
assets and the login header, so it was not re-run.

The pre-existing customer journey (`live_customer_flow_test.dart`) also
still passes end to end with zero overflow warnings.

## 9b. Visual audit — generic design patterns (IMPLEMENTED, BROWSER VERIFIED)

The admin was audited for generic AI/template design patterns and refined
**in the visual layer only** — no API, database, auth, RBAC, product,
promotion or customer behaviour changed (the test suites above are the
proof). The "Taste" skill named in the brief is not installed here; the
`ui-ux-pro-max` skill was used instead, keeping its density, motion and
accessibility guidance and rejecting its generic SaaS palette in favour of
the Blynk colours.

| # | Pattern found | Change |
|---|---|---|
| 1 | Centered card on a dark field for login | Split layout: brand panel (logo, "Operations", one-line purpose) beside the form |
| 2 | Three identical stat cards on the dashboard | One figures strip (live products, active categories, live promotions) plus a **"Needs a look"** list (no live promotion, unavailable products, disabled products) and the carousel running order |
| 3 | Flat type hierarchy | A type scale with a real display size for page titles |
| 4 | 8 px radius on everything | 4 px for controls, 10 px only for large surfaces |
| 5 | Template sidebar with a filled yellow pill | Ink sidebar, left-bar active state with a yellow rule |
| 6 | Generic coloured status pills | Dot + word ("• Live", "• Hidden") |
| 7 | Three identical ghost buttons per row | Quieter styling only — **not restructured** (see §10) |
| 8 | 1280 px content cap leaving dead space | 1600 px; tables in a horizontal-scroll wrapper with a right-aligned actions column |

Also: tables have a 2 px ink top rule, sticky headers and hairline rows;
motion respects `prefers-reduced-motion`.

## 9c. Brand logo

The supplied logo (multicolour "B" mark + "blynk" wordmark) replaced every
previous logo:

- **Customer app:** login header (`BlynkLogo` widget, mark + wordmark);
  native splash (logo on white; Android 12 shows the mark alone because it
  crops to a circle); launcher icons for Android, iOS, macOS, Windows and
  web, plus the web favicon.
- **Admin:** sidebar and login panel use the mark with a white wordmark
  (both sit on ink); the browser tab has a favicon.

The splash background moved from Blynk Yellow to white, because the mark's
orange clashes with yellow. The app's UI colours are unchanged.

## 10. Known limitations

- **Browser coverage:** the admin UI was driven by hand in Microsoft Edge:
  sign-in, dashboard, Products, Categories, and the promotion editor
  (sections, gradient presets, live preview, save), with the result
  confirmed on customer Home. Login was also checked at a narrow width.
  Product/category edit and promotion delete were **not** clicked through;
  they are covered by unit tests and the live API flow.
- **Row actions** are still three buttons per row (Edit / Hide·Show /
  Delete); only their styling was quietened.
- **Session length:** the admin access token expires after 15 minutes and
  there is no refresh flow, so an operator is signed out mid-session.
- **E2E leaves disabled products behind.** The backend has no product
  delete endpoint, so each E2E run ends by disabling its test product. Eight
  had accumulated; they (and five unreferenced upload files) were removed
  directly from the database after checking nothing referenced them.
- **Logo source resolution:** the logo came as a 1024 px JPEG in which the
  mark is ~230 px wide, so the 1024 px store icons are slightly soft. The
  onboarding photo `onboarding_groceries.png` still shows the old wordmark
  baked into the image.
- **Local disk storage** is single-host: it works for this deployment but
  will need the S3/GCS implementation of `MediaStorage` before the API runs
  on more than one instance. Images are also not virus-scanned.
- **No image reprocessing server side.** Downscaling happens in the browser;
  a direct API call could still store a 2 MB original.
- **Promotion scheduling** (start/end) is not implemented, by choice.
- **Category delete** is not offered because the backend has no such
  endpoint.
- **Orphaned media**: replacing, clearing or deleting removes the old file,
  but a file uploaded and then abandoned without saving the form stays on
  disk (one such promotion file was found during cleanup).
- **Dashboard counts** are computed from list endpoints, not a dedicated
  stats endpoint; fine at this catalog size.
- The admin app has **no pagination** on the product table yet (limit 200).

## 10b. Bugs this phase's own testing caught

Worth recording, because each was found by verification rather than review:

1. **Renamed payload accepted as an image.** The upload handler fell back to
   the client-declared `Content-Type` when magic-number sniffing failed, so
   `evil.png` containing PHP was stored. Now the sniffed type decides and
   anything unrecognised is refused. (Backend test.)
2. **Image delete silently did nothing.** `MEDIA_ROOT` is a relative path,
   so the containment check compared a relative path against an absolute one
   and returned early every time. The root is now resolved once in the
   constructor. (Backend test.)
3. **Images did not render in the admin app.** Helmet sets
   `Cross-Origin-Resource-Policy: same-origin` on every response, which
   blocked the admin origin (`:5173`) from displaying media served by the
   API (`:4000`). `/uploads` now sets `cross-origin` — only that route.
   (Found by opening the app in a browser; nothing automated would have
   caught it.)
4. **Operators could not see disabled products.** There was no admin product
   listing, only the customer's active-only one. Added `GET /admin/products`.
5. **A control that did nothing.** The product form had a "Tracking mode"
   select; `tracking_mode` is an `inventory` column, so the backend schema
   dropped it on every save. Removed, along with the blank table column it
   fed. `updated_at` (a genuine product column, missing from the catalog
   view) is now joined in so the "Updated" column shows real dates.

## 11. Application boundaries

Inventory and Rider are **separate applications**, not later tabs of Admin.
Each will consume the same backend and database:

- **Inventory app (next):** stock counts, receiving, adjustments,
  suppliers, purchase orders, automated deduction. The backend inventory
  module is untouched by this phase.
- **Rider app (later):** delivery operations, assignment, tracking, COD
  collection.

The Admin sidebar therefore contains exactly: Dashboard · Catalog (Products,
Categories) · Home (Promotions). A test asserts there are four navigation
links and no Inventory, Rider, supplier, stock or delivery entry anywhere in
the shell.

STATUS: ADMIN SCOPE CLEAN + PROMOTION BACKGROUND CONTROL VERIFIED

NEXT: INVENTORY APP (SEPARATE APPLICATION)
