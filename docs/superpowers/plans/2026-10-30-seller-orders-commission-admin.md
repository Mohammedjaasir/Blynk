# Seller orders + ready flow, rider pickup, free commission month, seller product tools, admin help (contract)

Owner's brother, 2026-10-30, after trying the seller app (shop "Blynk Western", approved, 1 live product):
1. When a seller gets orders they must get **notifications**; when the order is ready the seller sends the **notification to the rider**.
2. **Rider problem:** the rider doesn't know where to pick up the items from the seller (and the route to the customer isn't shown properly).
3. **Sellers only for Dharga Town for now: add that tagline.**
4. **Commission: 1 month free for a seller**, after that Admin decides the rate. In the seller app a **countdown** ("30 days to go", "29", "28"...).
5. Admin sets the commission rate **per category** (exists) and the **seller can set their own products active / inactive**.
6. From **Admin: create the products and the shop for a seller** when the seller doesn't know how.
7. **Photo is mandatory** when a seller adds a product.
8. **Admin doesn't show which products a seller sells.**
9. "Days ending" for the seller app = the countdown of item 4.
10. The seller app **always shows "Your shop is approved."**: not needed once approved.

Decisions taken by the lead (state them in your report, the owner can change them):
* Only the Option A rule (one seller per order, ON) matters for the ready flow: an order whose items all belong to ONE seller is that
  seller's order. A mixed order (rule switched off) still gets a "new order" push to each seller involved, but the **Ready** button is
  refused for it (409 `SELLER_ORDER_MIXED`, "Blynk will collect this order"): staff handle it.
* "Seller inactive" = the product is **unavailable** (`products.is_available = false`: greyed "unavailable" for customers, not
  orderable); `is_active` (listed at all) stays staff-only. The seller can switch it back on.
* The free month starts when the seller is approved (`sellers.commission_free_until = approval time + free_days`); `free_days` is a
  setting, default 30, 0 = no free period. After it ends the normal rates apply (seller override > category > main category > default).
* A seller never sees customer details (name, phone, address). They see order number, time, their own items and quantities, and what
  they earn for them.

Six builders work in parallel on separate areas; **never edit another builder's area; do not commit or push**. Preserve each file's line
endings (Read then Edit; backend files mix LF and CRLF). For shared backend files (`seller.routes.ts`, `seller.service.ts`,
`push.repository.ts`, `database/types.ts`, `app.ts`) make small additive edits and **re-read the file right before editing**, another
builder may have changed it. Run `npx tsc --noEmit` and the whole `npx vitest run --testTimeout=120000` of each app you touch (the machine is
shared and slow; a failure that passes when that file is re-run alone is a load timeout: say so). Backend builders: only run the relevant
test files plus `npx tsc --noEmit`, not the whole backend suite (the lead runs it). Node modules are installed for backend/api, apps/customer-app,
apps/admin, apps/operations, apps/rider and apps/seller. The dev database has migrations through 064; builder B2 adds **065** and applies it to the
local dev database only (`npm run migrate:up` in backend/api).

---------------------------------------------------------------------------------------------------------------------
## B1. Backend: seller orders, notifications, ready -> rider  (`backend/api`; NO migration needed)

* `GET /seller/orders?status=` (SELLER role, approved shop; same guard as the other seller routes): orders that contain this seller's
  products, newest first, last 60 days, max 100: `{ orders: [{ id, order_number, placed_at, status, ready_at, can_mark_ready, items:
  [{ product_id, name, quantity }], seller_amount }] }`. Items = ONLY this seller's lines (variant label folded into the name); no customer
  data, no totals other than `seller_amount` (their price x quantity, before commission). `status`: `NEW` (PLACED), `READY` (PACKED),
  `ON_THE_WAY` (OUT_FOR_DELIVERY), `DELIVERED`, `CANCELLED` (CANCELLED/FAILED/CUSTOMER_UNAVAILABLE). AWAITING_PAYMENT orders are not listed
  yet. `ready_at` = when it went PACKED (from the status history). `can_mark_ready` true only for NEW single-seller orders.
* `POST /seller/orders/:id/ready`: only for an order of this seller, only while PLACED, only when ALL its items are this seller's (else 409
  `SELLER_ORDER_MIXED`; 409 `ORDER_NOT_NEW` otherwise; 404 for someone else's order). It moves the order PLACED -> PACKED through the **order
  lifecycle engine** (`modules/orders/lifecycle`: study the existing PACK action in `actions/store.ts` and `catalogue.ts`; the engine writes
  the status history, the stock fulfilment ledger rows and the customer notifications; do NOT write order status or stock any other way, the
  stock-ledger-guard test forbids it). The actor is the seller's user (add what the engine needs to allow a seller actor for exactly this
  one transition; do not widen other transitions). Response: the same order shape as the list item.
* Push to the **seller** (use the existing `PUSH_TYPES.SELLER` / `notifySeller`, outbox, never fails the request):
  - when an order containing their products is **placed** (and paid when ONLINE: when it leaves AWAITING_PAYMENT): title "New order",
    body "#1283: 2 x Apple Pie, 1 x Samosa" (cut to 120 chars), `data { type: 'SELLER_NEW_ORDER', order_id, url: '/orders' }`;
  - when such an order is **cancelled**: title "Order cancelled", body "#1283 was cancelled. No need to prepare it.", type `SELLER_ORDER_CANCELLED`.
  Hook these where the order service / lifecycle already queues the customer and staff pushes (find `NEW_ORDER` staff push); one idempotency
  key per order+event.
* On **ready** push the rider: if a rider is assigned to the delivery, `PUSH_TYPES.RIDER_ASSIGNED`-style push "Order #1283 is ready" /
  "Pick up at <shop name>." `data { type: 'rider_order_ready', delivery_id, order_id }`; if no rider is assigned yet, push the staff
  (ADMIN/OPERATIONS, as the NEW_ORDER push does) "Order #1283 is ready at <shop>" / "Assign a rider." and let the existing auto-assign
  (`rider.auto-assign`) pick the order up as for any PACKED order.
* Pickup details for the rider and staff: `orderPickups` (`orders/pickup-points.ts`, used by the rider delivery detail
  (`rider.service.ts`) and the staff order detail) returns for each SELLER pickup: `{ kind: 'SELLER', seller_id, shop_name, lat, lng,
  address: string|null, how_to_find: string|null, phone: string|null, ready: boolean }` (`address` = the seller's shop address, `how_to_find` =
  the approved location's note, `phone` = the seller's sign-in phone as the shop contact, `ready` = the order is PACKED or later);
  for the STORE pickup: `{ kind: 'STORE', shop_name: 'Blynk store', lat, lng, address: null, how_to_find: null, phone: null, ready:
  true }` (add `shop_name` for it). Keep the existing fields.
* Tests (real Postgres): list shape and privacy (no customer fields anywhere in the JSON), role matrix, statuses, ready happy path (status,
  history, stock ledger, customer notification as the engine does), refusals (mixed, not new, other seller's, unapproved seller), pushes queued
  (seller new order, cancelled, rider/staff on ready), pickups fields.

---------------------------------------------------------------------------------------------------------------------
## B2. Backend: free commission month, pause products, photo, admin tools  (`backend/api`; migration 065)

* **Migration 065_seller_commission_free.sql** (+ `_down`, guard pattern: cached column check, feature off until run, never a 500):
  `ALTER TABLE sellers ADD COLUMN IF NOT EXISTS commission_free_until TIMESTAMPTZ NULL;` and a backfill for sellers already APPROVED:
  `commission_free_until = reviewed_at + 30 days` where null. `types.ts` updated.
* Setting: `seller_commission` (existing, `GET/PUT /admin/settings/seller-commission`) gains `free_days` (integer 0..365, default 30) in its JSON
  and in its GET/PUT shape (keep every existing field and test). On **approval** of a seller (admin approve action in
  `admin-sellers.service.ts`): when `commission_free_until` is null set it to now + free_days days (0 = leave null).
* Admin can change it per seller: `PATCH /admin/sellers/:id` accepts `commission_free_until: ISO | null`; seller rows (admin list/detail) carry
  `commission_free_until`.
* **Statement / earnings** (`seller.statement.ts`, `seller.commission.ts`, payouts "due"): for a delivered order the commission is **0** when the
  order's `delivered_at` < the seller's `commission_free_until`; later orders use the normal rates. Statement lines show the rate actually applied
  (0 during the free month). Tests with orders delivered before and after the boundary.
* `GET /seller/me` (and the object the seller app already loads) additionally carries `commission_free_until: string|null`,
  `commission_free_days_left: number|null` (whole days, rounded up, never negative; null when no free period or no 065), `commission_free_days:
  number` (the setting) .
* **Seller pauses a product**: `PATCH /seller/products/:id/availability` body `{ available: boolean }` (strict) sets `products.is_available`
  for the seller's own approved product (404 otherwise, 403 unapproved seller); audited `SELLER_PRODUCT_AVAILABILITY`; calls the catalog-changed
  notifier like the other product writes. `GET /seller/products` items additionally carry `is_available: boolean`. Customers see a paused product as
  unavailable through the existing mechanism (verify with a test on the customer catalog payload and that an order for it is refused).
* **Photo mandatory**: a NEW seller product submission needs a non-empty `image_url` (400 `IMAGE_REQUIRED`, "Add a photo of the product."); an
  EDIT may keep the existing one. Same rule when Admin creates a product for a seller (below).
* **Admin sees a seller's products**: `GET /admin/sellers/:id/products` (ADMIN, OPERATIONS) -> `{ products: [{ id, name, image_url, category_name,
  selling_price, seller_price, is_active, is_available, status: 'LIVE'|'PAUSED'|'OFF', stock_on_hand: number|null }] }` (LIVE = active and available,
  PAUSED = active but unavailable, OFF = not active), sorted by name, deleted products left out; also `products_total` on the seller rows if cheap.
* **Admin creates a product for a seller**: `POST /admin/sellers/:id/products` (ADMIN, OPERATIONS) body `{ name, category_id, unit, pack_size?,
  description?, image_url (required), seller_price, selling_price, barcode?, stock_quantity? }` -> creates a **live** product owned by the seller
  (`seller_id`, `purchase_cost = seller_price`, active + available, TRACKED inventory with the stock through the ledger if given), reusing the
  catalog's create code (study `POST /admin/products` and the seller submission approval that already creates a product), audited
  `ADMIN_CREATED_SELLER_PRODUCT`, catalog-changed notifier. Works only for an APPROVED seller. Response `{ product }` in the shape of the list item.
* **Admin sets a seller's shop location**: `PUT /admin/sellers/:id/location` `{ latitude, longitude, how_to_find? }` (ADMIN, OPERATIONS) writes an
  **approved** location directly (study `seller.location.ts` + migration 053 for the pending/approved model; same validation as the seller's own
  pin: inside the delivery radius rules if those apply to sellers), audited. `PATCH /admin/sellers/:id` already edits shop name / contact / address;
  confirm it covers everything the seller's own "Shop profile" has and report any gap.
* Tests: migration guard, setting, approval sets the date, per-seller change, statement boundary, `seller/me` fields, pause + customer payload +
  order refusal, photo required, admin list, admin create (incl. ledger row for stock, unapproved seller refused), admin location.

---------------------------------------------------------------------------------------------------------------------
## C. Seller app (`apps/seller`) - builder C

Code against the B1 and B2 contracts (mock them in tests).
* **Banner**: `StatusBanner` shows nothing for APPROVED (keep PENDING / REJECTED / SUSPENDED exactly as they are).
* **Tagline**: "Open to sellers in Dharga Town only, for now." under the brand on the sign-in page and on the home screen header area (small, calm
  style, in the site's palette).
* **Free commission countdown** (home card on My shop / the first screen): while `commission_free_days_left > 0`: "Commission-free: **23 days to
  go**" with a progress bar of days used out of `commission_free_days` ("1 day to go" singular); on the last day "Last commission-free day"; after
  it ended: "Commission-free month is over. Blynk's commission rates apply now." (shown for 7 days after, then nothing), nothing when null. A
  small pure lib (days-left text, progress) with tests.
* **Orders** (new tab "Orders" between My products and My stock; badge with the number of NEW orders): list from `GET /seller/orders` (poll every 30 s
  while the tab is open and refresh on the push foreground message): cards with order number, time, items x quantity, "You earn LKR X", a status chip
  (New / Ready / On the way / Delivered / Cancelled) and, for NEW + `can_mark_ready`, a big **"Order is ready"** button -> confirmation sheet ("Tell the
  rider the order is ready for pick-up?") -> `POST /seller/orders/:id/ready`, then the card shows "Ready, the rider has been told". Errors from the API
  shown on the card (mixed order: "Blynk will collect this order"). A notification tap (`data.url` = `/orders`) opens this tab (the service worker
  already opens `data.url`; make the router handle `/orders`).
* **Pause / resume** a product in My products: a switch on each approved product card ("On sale" / "Paused") calling the availability endpoint; paused
  cards look muted with a "Paused, customers can't order it" line. Error text under the switch.
* **Photo mandatory** in the add-product form: the form cannot be submitted without a photo (clear message "Add a photo of your product."), mark the field required;
  an edit keeps the existing photo.
* Tests for all of it; update tests that pin the old banner / tabs.

---------------------------------------------------------------------------------------------------------------------
## D. Rider app (`apps/rider`) - builder D

Code against the B1 `pickups` fields on the rider delivery detail (`GET /riders/deliveries/:id` data, find the existing typed field) and mock them.
* On the delivery screen show, above the destination, a **"1. Pick up"** card for each pickup: STORE = "Blynk store" ; SELLER = shop name (large), `address`,
  `how_to_find` ("Where to find it"), a **Call shop** link (`tel:`) when `phone`, a **Navigate to shop** button (Google Maps directions to its lat/lng, reuse
  `googleMapsDirectionsUrl`), and a status line: "Ready for pick-up" (green) when `ready`, else "The seller is still preparing this order" (amber). Then the
  existing destination section becomes **"2. Deliver to the customer"** with its Navigate button (unchanged behaviour). A small route header when there is a
  seller pickup: "Shop -> Customer". The map (`DeliveryMap`) draws the shop -> customer leg when a seller pickup exists (study the component; if drawing
  two points is not supported, show both markers or at least keep the customer route and say so in the report).
* The "being packed" note for seller orders must not say "The store hasn't packed this order yet" when the pickup is a SELLER and not ready: say "Wait for
  the seller to mark it ready before leaving." (keep the existing text for the store).
* Push: handle a tap on `rider_order_ready` (opens that delivery) like the existing `RIDER_ASSIGNED` handling; show the foreground notification the same way.
* Deliveries list (home): when a delivery has a seller pickup that is not ready, a small "At <shop>" line; when ready a green "Ready at <shop>".
* Tests; the rider app needs a new APK afterwards (the lead builds it).

---------------------------------------------------------------------------------------------------------------------
## E1. Admin (`apps/admin`) and E2. Operations (`apps/operations`) - one builder each, same features in each app's own style

* **Seller detail -> Products** card/section: the seller's products from `GET /admin/sellers/:id/products` (photo thumbnail, name, category, seller price,
  customer price, a status chip LIVE / PAUSED / OFF, stock) and a count in the sellers list ("N products live").
* **Add product for seller** (button on that section, only for APPROVED sellers): a form (name, category chooser from the existing categories API, unit, pack
  size, description, **photo upload required** (reuse the app's existing product image upload), seller price, customer price, barcode, opening stock) ->
  `POST /admin/sellers/:id/products`; on success the list refreshes. Validation messages inline; the API's `IMAGE_REQUIRED` shown under the photo.
* **Shop for seller**: on the seller detail make sure staff can edit shop name, contact name, address and note (exists as "Edit details": confirm), and add
  **Set shop location** (latitude, longitude, how to find it; also accept a pasted Google Maps "lat,lng" text; an "Open in Google Maps" link to check) ->
  `PUT /admin/sellers/:id/location`; show the current approved location and its distance if the data is there.
* **Commission free period**: on the seller detail's Commission area show "Commission-free until <date> (N days left)" with an **Edit date / Extend by
  30 days / End now** control (-> `PATCH /admin/sellers/:id { commission_free_until }`); in the seller commission settings screen (Admin: Sellers page
  panel, Ops: More -> Seller commission) a "Free month for new sellers (days)" field = `free_days` (0 = none).
* Tests for each; Ops is mobile-first (cards, sheets), Admin is table/dialog style.

---------------------------------------------------------------------------------------------------------------------
## Lead (not a builder task)
Website tagline on `/seller`, seller-site integration checks, full test runs, commit, Ops and Rider APKs.
