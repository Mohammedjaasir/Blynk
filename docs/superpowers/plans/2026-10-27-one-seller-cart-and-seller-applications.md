# One seller per order (Option A) + seller application form at blynk.lk/seller (contract)

Owner's brother (2026-10-27):
1. "Option A - One seller per order": a cart may hold items from only one seller (or only Blynk's own stock). Adding an
   item from a different seller shows **"Your cart has items from [Seller]. Start a new cart?"** with the choices to
   **clear the cart** or **keep the current one**. An admin setting with an on/off switch, **switched ON for now**.
   (Option B - mixed carts for sellers within X km, rider pickup checklist - comes later; do not build it, but keep the
   setting shape able to take it.)
2. "Can you make one form inside blynk.lk saying apply for seller registration; once they submit we receive the
   application, then we contact them directly by phone." The link is **blynk.lk/seller**.

How it works today (facts, verified in code): a cart/order can mix Blynk and seller items; one order, one delivery fee
measured from the FARTHEST pickup point (store or a seller's approved shop); the backend sends a `pickups` list in the
rider delivery detail and the staff order detail but NO app renders it yet; products carry `sold_by` (shop name) only.

Four builders work in parallel on separate areas; do not edit another builder's area; do not commit or push.
Preserve each file's line endings (Read then Edit). Run `npx tsc --noEmit` and the whole `npx vitest run
--testTimeout=120000` of each app you touch (the machine is shared and slow: a failure that passes when the file is run
alone is a timeout, say so). The backend dev database already has migrations applied up to 063; builder S adds 064 and
applies it locally with `npm run migrate:up` in backend/api (local dev database only).

---------------------------------------------------------------------------------------------------------------------
## P. Cart rule backend (`backend/api`) - builder P  (do NOT touch the seller-applications files of builder S)

* Setting `cart_rules` in `system_configurations` (no migration), shape
  `{ "one_seller_per_order": { "enabled": boolean } }`; **default when no row = enabled: true** (owner: ON for now).
  Follow the pattern of `configuration/delivery-radius.ts` / the checkout switches: read helper (tolerates malformed
  rows), `GET /admin/settings/cart-rules` and `PATCH /admin/settings/cart-rules` (ADMIN, OPERATIONS; body
  `{ one_seller_per_order: { enabled: boolean } }`, strict; audited as `CART_RULES_UPDATED`), response
  `{ one_seller_per_order: { enabled }, updated_at }`.
* Public `GET /store` gains `one_seller_per_order: boolean` (the effective value).
* Customer catalog payload (products list / detail / anything that already carries `sold_by`) additionally carries
  `seller_id: string | null` (the same approved-seller condition as `sold_by`; null for Blynk's own products).
  Keep it working before migration 052 (null), like `sold_by`.
* Enforcement at order placement (`POST /orders`): the order's "sources" are the distinct seller ids of all its items,
  including combo items, with Blynk's own products as one source (null). With the rule enabled and more than one
  source: 422 `MIXED_SELLERS_NOT_ALLOWED`, message "Your cart has items from different sellers. Please order from one
  seller at a time.", `details: { sources: [{ seller_id: string|null, name: string }] }` (name = shop name, or "Blynk").
  Check it before stock/price work so nothing is reserved. Disabled = today's behaviour exactly.
* Server-side flows that place orders without the app's cart: repeat baskets (worker) and anything else that calls the
  order service must not crash or half-place on this error: confirm what the repeat-basket runner does with a failed
  placement (it must record the failure reason like other refusals; add a test) and report any other caller.
* Tests: setting get/patch/validation/roles/audit/default-on; /store flag; `seller_id` on products; refusal for a
  seller+Blynk cart, two sellers, a combo containing a seller product; allowed for one seller only, Blynk only,
  repeated same seller; switch off allows mixed; repeat-basket failure path. Update tests that pin the exact /store
  or product payload shape.

---------------------------------------------------------------------------------------------------------------------
## Q. Customer app (`apps/customer-app`) - builder Q

* Types: `StoreInfo.one_seller_per_order?: boolean` (absent = treat as ON? NO: absent = OFF, an older server has no
  rule), `Product.seller_id?: string | null`.
* The cart's **source** = `seller_id` of its lines' products (fallback `sold_by` text when `seller_id` is missing),
  Blynk's own products = one source. Pure helpers with tests in `src/blynk/cart/` (e.g. `sourceOf(product)`,
  `cartSource(lines)`, `conflictFor(cartLines, product, rule)`), then wire the rule into **every** way an item enters the
  cart where a NEW source could appear: product card "+", product page, size picker, Buy again / "Your usuals" Add all,
  reorder from an order, repeat-basket "add", combo packs, search results. One central place in the cart provider
  (`src/lib/cart.tsx`) is preferred over patching each screen.
* When the rule is ON and the item's source differs from the (non-empty) cart's source, do not add it; show a modal
  (a global host like `SizePickerHost`): title **"Start a new cart?"**, text **"Your cart has items from [Seller]. Start
  a new cart?"** where [Seller] is the cart's current source name (shop name, or "Blynk" for Blynk's own items), buttons
  **"Clear cart and add"** (clears, then adds the item(s)) and **"Keep current cart"** (closes, nothing changes). For
  bulk adds (Add all / reorder / repeat basket) the same prompt appears once; "Clear cart and add" replaces the cart
  with the items of the first source in that bulk list and tells the customer how many items were left out ("N items
  from other sellers were not added") through the app's existing notice mechanism.
* The cart screen keeps working for carts that were mixed before the rule (a persisted cart): do not delete it; the
  server answers MIXED_SELLERS_NOT_ALLOWED at checkout -> map that code to the same friendly message with a button
  "Start a new cart" that keeps only the first source's items (use the app's existing order-error mapping,
  `orders/errors.ts`).
* All new words in `localized` blocks (English + Sinhala + Tamil; read `docs/superpowers/plans/2026-10-25-translations.md`
  and `src/blynk/i18n/**`; blocks in plain `.ts` files under `src/blynk/cart/`), completeness test must pass.
* Tests for the pure logic (all the cases above) and the translation test pattern used elsewhere.

---------------------------------------------------------------------------------------------------------------------
## R. Admin + Ops cart-rule settings (`apps/admin`, `apps/operations`) - builder R

* A "Cart rules" card in Admin -> Settings and Ops -> More (next to the delivery fee / checkout cards, same patterns,
  api file, lib helper with tests): switch **"One seller per order"** with the text "A cart can hold items from only one
  seller, or only Blynk's own products. If a customer adds something from a different seller they are asked to start a
  new cart." Saves `PATCH /admin/settings/cart-rules` (contract in section P); loads with `GET`; shows the saved state
  and errors like the neighbouring cards do; default shown ON when the API has no value yet. Below the switch a muted
  line: "Mixed carts for nearby sellers: coming later." (text only, no control).
* Tests for both apps (render, toggle, save, error).

---------------------------------------------------------------------------------------------------------------------
## S. Seller applications (`backend/api` new module, `apps/admin`, `apps/operations`, `apps/customer-site`) - builder S

Study how rider applications work first (public apply + staff review: grep "rider application" in backend/api and
apps/admin, apps/operations) and mirror it.

### S1. Backend
* Migration **064_seller_applications.sql** (+ `_down`), table `seller_applications`: id uuid pk, shop_name, owner_name,
  phone (normalized +94...), email null, town, what_they_sell (text), message null, status
  `NEW|CONTACTED|APPROVED|DECLINED` default NEW (check constraint), staff_note null, handled_by null, handled_at null,
  source text default 'WEBSITE', ip_hash null, created_at, updated_at; index on (status, created_at desc) and phone.
  Guard pattern of the other hand-run migrations (cached table-exists check, `SELLER_APPLICATIONS_NOT_READY`).
* Public `POST /seller-applications` (no auth): strict zod body `{ shop_name, owner_name, phone, town, what_they_sell,
  email?, message?, website? }` (`website` is a honeypot: when filled, answer 200 and store nothing), Sri Lankan mobile
  validation like the rest of the API, lengths capped, rate limit per IP (e.g. 5 per hour, existing rate-limiter
  pattern), the same phone applying again while an application is NEW/CONTACTED answers 200 without a duplicate row
  (friendly, no data leak). Not ready -> 503 with a message the website can show. Response `{ received: true }` only.
  CORS: the website origin (blynk.lk) must be allowed (check `CORS_ORIGINS` handling and how the landing page already
  calls the API; add nothing secret).
* Staff: `GET /admin/seller-applications?status=` (ADMIN, OPERATIONS; newest first, NEW first), `PATCH
  /admin/seller-applications/:id` `{ status?, staff_note? }` (audited, sets handled_by/at), count of NEW in the
  response (`new_count`) for badges. When an application arrives, queue a **push to staff** using the existing staff
  push mechanism (see `PUSH_TYPES.NEW_ORDER` and how staff devices are targeted) with title "New seller application",
  body "<shop_name> (<town>)"; failure never fails the request.
* Tests: real-Postgres (public happy path, validation, honeypot, duplicate, rate limit, not-ready 503, staff list /
  patch / roles / audit, push queued).

### S2. Admin + Ops screens
* Admin: "Seller applications" page (nav under Sellers, with a NEW count badge): table of applications (shop, owner,
  phone as a tap-to-call link, town, what they sell, message, when), status filter, set status Contacted / Approved /
  Declined, a staff note box, and an **"Add as seller"** button that opens the existing Add seller flow with shop name,
  owner name and phone prefilled (read how Add seller is built in both apps; prefill through a query/route state).
  Ops: the same as a mobile-first screen under More -> Sellers (with the badge on the More entry). Tests for both.

### S3. Website form `blynk.lk/seller` (`apps/customer-site`)
* A new static page `seller.html` in the style of the other landing pages (reuse `landing.css`, header/footer; no photos
  of people unless local; no mosque imagery; **no typed-in opening hours anywhere**): headline "Sell with Blynk",
  two lines on how it works (we deliver for you, you set your prices, we pay you), the form (shop name, your name, phone
  number, town, what you sell, optional email and message, a hidden honeypot field named `website`, a short consent
  line "We will call you on this number about your application. See our Privacy Policy."), a clear success state
  ("Thanks! We received your application and will call you soon."), error states (validation messages per field,
  rate limit, server not ready -> "Please call or WhatsApp us" with the store's phone/WhatsApp link the legal pages
  already use via the generator tokens `{{phoneLink}}` / `{{whatsappLink}}`).
* Plain JS `seller.js` (no framework) posting JSON to the API base URL the landing page already uses for `/store`
  (find it in `app.js`); double-submit protection; works without JS? (no: say so in a `<noscript>` with the phone link).
* nginx: serve `/seller` (and `/seller/`) as that page like `/privacy` (`^/(privacy|terms|refunds|delete-account)/?$` is
  the existing pattern), Dockerfile COPY, sitemap/SEO generation scripts (`scripts/build-seo-pages.mjs`) and the page's
  title/description/canonical; add a "Become a seller" link in the landing footer; add one sentence about seller
  applications (what is stored, why, how long, how to delete) to the privacy page source (`legal/privacy.md`) and bump
  `lastUpdated` in `legal-config.json` the way earlier edits did. Update the customer-site tests that pin the footer /
  legal text (`tests/*.test.mjs`) and add tests for the new page (form fields, honeypot, script posts the right JSON with
  a mocked fetch).
* Run the customer-site tests (`node --test` or the script its package.json defines).
