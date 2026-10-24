# Buy again + repeat baskets - contract (2026-10-24)

Owner, 2026-10-24: "'Buy again' and repeat baskets: a Buy again list on Home, and 'deliver this basket every Monday'
or a daily milk and bread subscription ... add this now with some animations ... and in the empty card animation
something pop-up / moving, it would be attractive for customers."

## 1. Buy again (no migration)

`GET /api/v1/me/buy-again` (signed-in CUSTOMER) ->
`{ items: [{ product_id, variant_id: string|null, times_bought, last_bought_at, last_quantity }] }`
from the customer's DELIVERED orders in the last 180 days (loose items only, not combos; items packed UNAVAILABLE or
SUBSTITUTED do not count), ranked by times_bought desc then last_bought_at desc, at most 24. Products that are deleted
are left out; switched-off/sold-out ones are still returned (the app decides what to show).

## 2. Repeat baskets (migration 054)

Tables:
- `repeat_baskets`: id, user_id, name (<=40, default "My basket"), items JSONB `[{product_id, variant_id|null, quantity 1-20}]`
  (1-30 lines), frequency 'DAILY' | 'WEEKLY' | 'BIWEEKLY', weekday SMALLINT 0-6 (0 = Sunday; required for WEEKLY/BIWEEKLY),
  place_at 'HH:MM' (Colombo time the order is placed; must be inside the store's opening hours on that day), address_id
  (customer_addresses), notes (<=300), status 'ACTIVE' | 'PAUSED' | 'CANCELLED', skip_next BOOLEAN, next_run_at TIMESTAMPTZ,
  last_run_at, last_order_id, created_at, updated_at. At most 5 non-cancelled baskets per customer.
- `repeat_basket_runs`: id, basket_id, run_at, status 'PLACED' | 'SKIPPED' | 'FAILED', order_id NULL, reason VARCHAR(300).
- `orders.repeat_basket_id` UUID NULL (the basket an order came from).
Migrations are run by hand in Coolify, so every endpoint answers 503 `REPEAT_NOT_READY` until 054 exists (cached column/table
check), and GET /api/v1/store gains `repeat_baskets_enabled: boolean` (false until then). Never a 500.

Customer API (CUSTOMER, own baskets only):
- `GET /api/v1/me/repeat-baskets` -> `{ baskets: RepeatBasket[] }` (not CANCELLED), each with `next_run_at`, `last_run`
  (`{ run_at, status, order_id, reason }` or null) and `estimate` `{ items_total, available_lines, unavailable_lines }` at today's prices.
- `POST /api/v1/me/repeat-baskets` `{ name?, items, frequency, weekday?, place_at, address_id, notes?, start_date? (YYYY-MM-DD, default today/tomorrow) }` -> 201 `{ basket }`.
- `POST /api/v1/me/repeat-baskets/from-order/:orderId` `{ frequency, weekday?, place_at, address_id?, name? }` -> 201 `{ basket }`
  (items copied from that order's delivered loose lines; address defaults to that order's address).
- `PATCH /api/v1/me/repeat-baskets/:id` any of the fields above plus `status: 'ACTIVE' | 'PAUSED'` -> `{ basket }` (next_run_at recomputed).
- `POST /api/v1/me/repeat-baskets/:id/skip-next` -> `{ basket }` (toggles skip_next; the next run is SKIPPED and cleared).
- `DELETE /api/v1/me/repeat-baskets/:id` -> `{ basket }` (status CANCELLED).
Errors: 400 VALIDATION_ERROR (field), 404 BASKET_NOT_FOUND, 409 BASKET_LIMIT (5), 400 PLACE_AT_OUTSIDE_HOURS, 503 REPEAT_NOT_READY.

Runner (backend): every minute (wire it like the existing background workers, e.g. the notification outbox worker; one instance
at a time - advisory lock / FOR UPDATE SKIP LOCKED), ACTIVE baskets with next_run_at <= now:
- skip_next -> run SKIPPED ("Skipped by you"), clear skip_next;
- store closed / holiday at that moment -> SKIPPED ("Store closed"), notify;
- otherwise place a normal cash-on-delivery, as-soon-as-possible order AS THE CUSTOMER through the existing order service (same
  pricing, offers, delivery fee incl. pickup points, free deliveries, availability windows, stock); lines that cannot be ordered
  now (sold out, switched off, outside hours, deleted) are left out and named in the run reason; nothing orderable -> SKIPPED;
  set orders.repeat_basket_id; run PLACED;
- then compute the next next_run_at (DAILY +1 day, WEEKLY +7, BIWEEKLY +14 at place_at Colombo);
- tell the customer (push + SMS, same outbox and templates style as order SMS): placed "Blynk: your repeat basket '<name>' is
  ordered - order <number>, LKR <total>. Change or skip it in the app." / skipped with the reason. Staff get the normal new-order alert.
Customer order DTOs gain `repeat_basket_id`.

Staff API (ADMIN, OPERATIONS): `GET /api/v1/admin/repeat-baskets?status=` -> list with customer name/phone, items count, schedule,
next_run_at, last run; `PATCH /api/v1/admin/repeat-baskets/:id` `{ status: 'PAUSED' | 'ACTIVE' | 'CANCELLED' }` (audited
REPEAT_BASKET_UPDATED). Staff order list/detail carry `repeat_basket_id` (Ops/Admin show a "Repeat" tag).

## 3. Customer app (Agent N)
- Home: a "Buy again" rail for signed-in customers right after the hero/offer area: products from /me/buy-again joined with the
  catalogue (orderable first; sold-out ones at the end greyed), quick add, a "Buy again" header with a subtle animated
  refresh/loop icon. New/guest customers or no history: an attractive animated empty card - groceries popping up one after another
  into a basket / a playful moving illustration (pure RN Animated / reanimated, reduced-motion safe) with "Your favourites will
  appear here after your first order" and a "Start shopping" action.
- Order detail (delivered orders) and the cart: "Repeat this basket" -> bottom sheet: Every day / Every week (pick weekday) /
  Every 2 weeks, time (from the store's opening hours, quarter hours), address, start date, summary + estimate -> create.
  Confetti / success animation on create.
- "Repeat baskets" screen (from Profile/Account and from the Home rail): cards with next delivery countdown ("Next: Mon 8:00 am"),
  items preview, pause/resume switch, "Skip next", edit items/quantities and schedule, cancel; last run status (placed with order link /
  skipped with reason). Animated list transitions.
- Hidden entirely while /store `repeat_baskets_enabled` is false. Pure logic in src/blynk/** with vitest tests.

## 4. Staff screens (Agent O)
Admin page "Repeat baskets" (nav group Customers) and Ops (More -> Repeat baskets): list, filters, pause/resume/cancel with confirm;
"Repeat" tag on order list/detail in Admin and Ops when `repeat_basket_id` is set.
