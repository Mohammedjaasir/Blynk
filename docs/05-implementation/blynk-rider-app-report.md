# Blynk Rider App: Foundation Report

**Date:** 2026-09-18
**Scope:** Rider App foundation (plan `docs/superpowers/plans/2026-09-18-blynk-rider-app.md`, Tasks 1–13, decisions R1–R13 approved as recommended)
**Status:** complete and verified. Nothing is committed.

---

## 1. What was built

A separate, mobile-first web app, `apps/rider` (React 18 + Vite 5 + TypeScript, port 5175). It lets a signed-in rider work only the deliveries assigned to them:

1. pick up;
2. mark arrived;
3. collect the cash-on-delivery amount, which completes the delivery;
4. or report that the delivery couldn't be made.

It talks only to the existing Blynk API. There is:
- no new backend or database;
- no migration;
- no new order or delivery states;
- no WebSockets, maps, GPS, ETAs or offline sync.

```
Customer app ──┐
Admin app ─────┤
Inventory app ─┼──→ Blynk API (Express, one process) ──→ PostgreSQL
Rider app ─────┘
```

The rider's actions change the same `deliveries`, `orders`, `payments`, `order_status_history` and `notifications` rows the rest of Blynk uses. The Customer app sees the result through its existing `GET /orders` and `GET /orders/:id`; there is no rider-to-customer channel.

## 2. Authentication and role checks

| Concern | How it works |
|---|---|
| Sign-in | The existing OTP flow (`/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/me`). There is no second auth system. |
| Role | Every `/riders/*` route requires the `RIDER` role, taken from the server-signed token. Customer, packing staff and admin all get 403 (tested). |
| Rider profile | The API looks up the `riders` row for the signed-in user. None → 403 `RIDER_PROFILE_NOT_FOUND`. `is_active = false` → 403 `RIDER_INACTIVE` (**new**). |
| Ownership | Every query is scoped to `deliveries.rider_id = <caller's rider>`. Another rider's delivery, or an order id sent as a delivery id → 404 `DELIVERY_NOT_FOUND`, which reveals nothing. The rider id is never read from the request. |
| UI | Non-rider sessions are signed out with "This app is for Blynk riders." A profile refusal signs out with "Your rider profile isn't active." This is a courtesy only; the API decides. |
| Dev skip | `VITE_DEV_RIDER_PHONE` plus an inline `import.meta.env.DEV` check (the D5 pattern). It runs the real OTP flow with the dev code. The production bundle was checked and contains no "Skip sign-in" text, no dev phone and no variable name. |

## 3. Delivery lifecycle (enforced by the backend)

Every rider step locks the **delivery** row and then the **order** row. collect-cod uses the same order. Customer cancellation and admin status changes lock only the order, so these locks can't form a cycle.

| Delivery | Order | Rider request | Result |
|---|---|---|---|
| ASSIGNED/ACCEPTED | PACKED | `PICKED_UP` | Delivery PICKED_UP; order OUT_FOR_DELIVERY; history `PACKED→OUT_FOR_DELIVERY`; OUT_FOR_DELIVERY SMS queued |
| ASSIGNED | PLACED / ITEM_UNAVAILABLE | `PICKED_UP` | 409 `ORDER_NOT_READY_FOR_PICKUP` |
| any | CANCELLED / DELIVERED / FAILED / CUSTOMER_UNAVAILABLE | anything | 409 `ORDER_NOT_ACTIVE` |
| PICKED_UP | OUT_FOR_DELIVERY | `ARRIVED_AT_CUSTOMER` | Delivery ARRIVED_AT_CUSTOMER |
| PICKED_UP / ARRIVED | OUT_FOR_DELIVERY | `FAILED` + reason (1–500 chars, required) | Delivery FAILED with the reason; order FAILED; history note "Delivery failed" |
| ARRIVED | OUT_FOR_DELIVERY | `POST collect-cod {amount}` | See §4 |
| any other combination | | | 409 `INVALID_DELIVERY_TRANSITION` with `{current_status, requested_status}` |

`ASSIGNED`, `ACCEPTED`, `REJECTED` and `DELIVERED` are no longer accepted from a rider (400). Completion happens **only** through collect-cod, so the delivery, payment and order can't disagree. Before this change, `PATCH {DELIVERED}` marked the delivery delivered while leaving the order out for delivery.

## 4. Cash on delivery

`POST /riders/deliveries/:id/collect-cod` runs as one transaction with the delivery and order rows locked. It requires:
- the payment is not already PAID and the delivery not already DELIVERED, else 409 `COD_ALREADY_COLLECTED` (architecture §I.4);
- the order is active, else 409 `ORDER_NOT_ACTIVE`;
- the delivery is ARRIVED_AT_CUSTOMER and the order OUT_FOR_DELIVERY (architecture §I), else 409 `INVALID_DELIVERY_TRANSITION`;
- `payment_method = COD`, else 409 `NOT_COD_ORDER`;
- `amount == orders.total_amount` **as read under the lock**, else 400 `INVALID_COD_AMOUNT`. The earlier code checked the amount on a read taken before the transaction, so a total changed in between (e.g. an item marked unavailable) was settled at the stale amount. A test reproduces that interleaving with a second database connection.

Then the existing settlement runs: delivery DELIVERED plus the amount, payment PAID, order DELIVERED/PAID, history, and the DELIVERED and COD_PAYMENT_CONFIRMED SMS.

The rider never types an amount. The app sends the total it fetched and restates it in a confirm sheet ("Collect Rs. 610 in cash from …").

## 5. Assignment (admin API, unchanged route)

`POST /admin/orders/:id/assign-rider` (ADMIN only) now locks the order, then checks:
- the order is PACKED (architecture §H), else 409 `ORDER_NOT_READY_FOR_ASSIGNMENT`;
- the rider exists, else 404 `RIDER_NOT_FOUND` (it was a 500 foreign-key error);
- the rider is active, else 409 `RIDER_INACTIVE`;
- no active assignment exists, else 409 `ORDER_ALREADY_ASSIGNED` (it was a 500). The partial unique index is still there, and a violation of it is reported as the same 409.

Two concurrent assignments of one order give 200 + 409.

## 6. Customer integration and privacy

- **Tracking:** unchanged endpoints. A rider's pickup appears to the customer as `OUT_FOR_DELIVERY`, collection as `DELIVERED` / `PAID`, and a failure as `FAILED`.
- **R7:** the customer's `order.delivery` is now `{assignment_status, assigned_at, picked_up_at, delivered_at}` only. The rider id, cash ledger, handover notes and failure reason are removed. The Flutter app doesn't read this object, so its UI is unchanged.
- **Failure notes:** the rider's failure reason no longer reaches the customer through `history[].reason_or_notes`. That history row now says "Delivery failed", and the rider's words stay on `deliveries.failure_reason` for staff. A test caught this leak.
- **Cancellation (R9):** `cancelOrder` now locks the order and re-applies the **same** rule (PLACED/PACKED only). A customer cancel racing a rider pickup has exactly one winner; before, both could succeed and leave an order that was both cancelled and out for delivery. The history row now records the real previous status; before, it always said CANCELLED.
- **What the rider sees:** recipient name and phone (a `tel:` link), address lines, city, delivery instructions, bag items (name × quantity, unavailable items excluded; R6), payment method and total. The rider never sees costs, markup, suppliers, inventory, internal notes, the customer id or coordinates. Tests check this in both the API response and the rendered page.

## 7. API contract changes

| Endpoint | Change |
|---|---|
| `GET /riders/deliveries` | R5: returns active assignments plus anything delivered, or closed under the rider, since midnight Asia/Colombo. Oldest assignment first. |
| `GET /riders/deliveries/:id` | Adds `items[]`. Malformed id → 400. |
| `PATCH /riders/deliveries/:id/status` | Status is one of `PICKED_UP`, `ARRIVED_AT_CUSTOMER`, `FAILED`. FAILED requires `failure_reason`. Transition rules and error codes as in §3. |
| `POST /riders/deliveries/:id/collect-cod` | State, payment and in-transaction amount checks (§4). |
| `POST /admin/orders/:id/assign-rider` | §5. The existing `orders.test.ts` assertion changed from 500 to 409. |
| `POST /orders/:id/cancel` | Same rule, now enforced atomically. Same responses. |
| `GET /orders[/:id]` (customer) | Trimmed `delivery` (R7). |

No endpoint was added or renamed. **No database migration.**

## 8. The Rider app

| Screen | Content |
|---|---|
| Sign in | OTP, plus the dev-only Skip button |
| Deliveries | **Now:** the delivery to act on (at the door > on the road > oldest ready to pick up), with destination, #number, recipient, cash to collect and an Open delivery button. **Next:** one line per other assignment ("Being packed", "Cancelled — don't pick up"). **Done today:** count and cash collected. There is a real empty state. The list refreshes every 30 s while visible, when the app returns to the front, and when the connection comes back (no push). |
| Delivery | #number, a three-step progress line (Pick up → On the way → Handover), destination, customer note, call button, bag, and the cash block (the largest element at the door). One yellow action in the thumb zone. "Can't deliver" (needs a reason) appears only once the order is on the road. |

Failure handling:
- **409 (stale state):** the app shows the rider-worded reason and re-reads the delivery.
- **Timeout (15 s):** the app re-reads **before** offering retry, so a step that landed isn't repeated.
- **Offline:** "Nothing was sent", with the last-updated time.
- **404:** back to the list with the reason.
- **Double taps:** one request only.

Visual direction, "the dispatch slip":
- warm paper `#FBFAF5`, ink `#12151F`, Catamaran, with JetBrains Mono for order numbers and phone;
- Blynk Yellow `#FFE141` only for the next action;
- Blynk Green `#0C831F` only for "Delivered".

No cards, maps, avatars or ETAs.

## 9. Testing

| Suite | Result |
|---|---|
| Backend (Vitest + supertest, real Postgres) | **381/381**, 17 files. New: `tests/rider-delivery.test.ts` (38 tests). Changed: `tests/orders.test.ts` (the rider fixture packs the order first; the duplicate assignment expects 409). |
| Rider app (Vitest + Testing Library) | **49/49** (auth 10, delivery rules 21, deliveries page 7, delivery page 11) |
| Admin / Inventory (unchanged) | 15/15 and 58/58; typecheck and build clean |
| Typecheck / builds | backend `tsc` + build clean; rider `tsc` + `vite build` clean |

Every backend rule was written test-first and seen failing for the expected reason. Two failures were real bugs reproduced before any fix:
- a rider picked up a **cancelled** order (200);
- cash collected at a **stale** total (200).

The concurrency tests passed on every repeat run (5× for pickup and cash collection, 3× for assignment and cancel-vs-pickup):
- double pickup: 200 + 409, one history row, one SMS;
- double collection: 200 + 409, one settlement;
- one order assigned to two riders at once: 200 + 409;
- customer cancel racing a rider pickup: consistent every time;
- admin cancelling while the rider collects: 409, and the payment stays PENDING.

The rider tests cover:
- **Security (IDOR):** rider B reading, moving or settling rider A's delivery → 404; an order id used as a delivery id → 404; a `rider_id` or amount slipped into a request is ignored; customer, staff and admin get 403 on every rider endpoint; malformed ids → 400.

## 10. Live E2E (real API, real database, real Edge on Pixel 7 emulation, real OTP)

Harness: `scratchpad/e2e/rider_live.cjs`, outside the repo.

1. The customer places a COD order (Rs. 540 + Rs. 70 = **Rs. 610**, from the backend).
2. Assigning it before packing is refused (409).
3. Staff marks it PACKED; admin assigns the seeded rider. DB: delivery ASSIGNED, order PACKED.
4. The rider signs in with OTP. The order is NOW, with destination and Rs. 610. The delivery shows the call link, note and bag, with no coordinates, costs or suppliers.
5. **Picked up** → DB: PICKED_UP / OUT_FOR_DELIVERY, timestamps, one history row, one SMS. The customer API shows OUT_FOR_DELIVERY with only the 4 safe delivery fields. A late customer cancel → 400. A repeated pickup → 409. Collecting before arrival → 409.
6. **I've arrived** → DB: ARRIVED_AT_CUSTOMER. A wrong amount → 400.
7. **Collect Rs. 610** → confirm → DB: delivery DELIVERED Rs. 610, payment PAID, order DELIVERED/PAID, one history row, the DELIVERED and COD_PAYMENT_CONFIRMED SMS. The customer API shows DELIVERED/PAID.
8. Negative checks, all refused:
   - a second collection → 409 `COD_ALREADY_COLLECTED`;
   - the rider sending DELIVERED directly → 400;
   - customer or admin tokens on rider routes → 403;
   - the rider token on admin orders or assign-rider → 403;
   - an order id used as a delivery id → 404;
   - a malformed id → 400.
9. Home shows "1 delivered · Rs. 610 collected". No browser console errors.
10. Cleanup (transactional): 1 order, 1 delivery, 1 payment, 5 notifications, 1 address. **The database matches the pre-run baseline** (orders 13, deliveries 0, riders 1, users 37, addresses 19, payments 13, notifications 24, products 5).

Result: **35/35**, run once before and once after the visual refinement. The Customer Flutter app (Windows) was also **checked by hand**: after signing in, Orders showed `BL-20260918-3684 · Rs.610 · Delivered`.

## 11. Generic AI design audit

The audit was run on the E2E screenshots. The findings, and the fixes (visual layer only; all tests and the live E2E unchanged afterwards):

1. **Money looked like code output.** JetBrains Mono rendered "Rs.  610" with a gap. Fix: amounts use Catamaran 900 with tabular figures; the amount at the door is 48–64px.
2. **Yellow didn't mean one thing.** It was also the customer-note background and the current step on the progress line. Fix: the note uses an ink rule on paper, the current step is an ink ring, and yellow is now only the next action (and the banner accent).
3. **Status was said twice.** A "Ready to pick up" label repeated the progress line. Fix: the label shows only for exceptions (being packed, cancelled, couldn't deliver).
4. **The confirm sheet faded in from 40% opacity**, so the page showed through it. Fix: it slides up fully opaque; only the backdrop fades.
5. **Sign out sat on the delivery screen.** Fix: it's on the home screen only.
6. **The delivered view kept the customer note.** Fix: hidden once delivered.
7. **The bag's quantity column had a wide gap.** Fix: it's now auto-width.

## 12. Limitations and future work

- **No dispatch UI (R12).** Packing and assignment happen through the admin API only. Where a dispatch screen should live is still an open decision (not the Rider app).
- **Customer unavailable (R3)** is deferred. Riders use Can't deliver, and the order shows FAILED.
- **Documented but not built:** accept/reject (R2), the availability toggle (`PATCH /rider/me/status`), a rider profile endpoint (`GET /rider/me`), and `GET/POST /admin/riders`.
- **Admin status changes** (`PATCH /admin/orders/:id/status`) still ignore the documented transition matrix (G13). Staff can set DELIVERED or OUT_FOR_DELIVERY directly. This needs a separate hardening phase.
- **Reassignment after a failure** conflicts with the docs (G14): a failed delivery sets the order to FAILED, while assignment requires PACKED.
- **Other histories:** order-history notes written by other flows (admin status notes, customer cancellation reasons) still reach the customer. Only the rider's failure note was changed.
- **No push.** New assignments appear within 30 s, or on app focus or refresh.
- **No maps (R11)**, no live location, no ETAs, no offline queueing, no proof of delivery. These are future capabilities only if the requirements change.
- **Pre-existing test leak.** `tests/notifications.test.ts` inserts 19 notifications with no order and never deletes them. They're removed only if `orders.test.ts` runs later in the same run. That depends on file order, so the Phase 1.5 claim that "a full run leaves the database unchanged" is order-dependent. After this phase's full run the 19 rows were removed with a guarded script. The test file itself is unchanged.
- **Pre-existing customer app issues:** the Orders list shows "0 items" (the list endpoint has no items), and tapping an order opens nothing. Both are unchanged here.
- The live E2E harness lives outside the repo.
