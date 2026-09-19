# Blynk Dispatch & Order Operations Hardening: Report

**Date:** 2026-09-19
**Plan:** `docs/superpowers/plans/2026-09-19-blynk-dispatch-order-operations.md` (§O is the canonical lifecycle). Decisions D1–D15 were approved as recommended, with D6 = B (admin re-stage).
**Status:** complete and verified. Nothing is committed.

---

## 1. Requirements delivered

1. **One state machine.** A single canonical order-lifecycle mechanism now covers every status-changing path. No endpoint can update `orders.order_status` outside it, and a static test enforces that.
2. **Documented transitions, enforced server-side.** Each transition has deterministic HTTP and error codes, transaction-safe locks, and concurrency tests.
3. **Packing workflow** for PACKING_STAFF and ADMIN, built on the existing status endpoint.
4. **Rider assignment workflow** for ADMIN, on the hardened assign API plus the documented `GET /admin/riders`. It lists active riders only. There is no auto-dispatch, no self-assignment and no availability system.
5. **Failed-delivery recovery (D6 = B).** A new ADMIN transition, FAILED/CUSTOMER_UNAVAILABLE → PACKED, lets the order be reassigned. No new state was added.
6. **Customer Orders fixes.** The list showed "0 items" and tapping a row did nothing; both are fixed. The order detail now also shows the status (D14).
7. **An Orders workflow in the Admin app** (D12), the documented "admin/staff dashboard". PACKING_STAFF see Orders only. Inventory's scope is unchanged.

## 2. The canonical lifecycle

The code lives in `backend/api/src/modules/orders/lifecycle/`:

| File | Role |
|---|---|
| `catalogue.ts` | The 14 actions as data: from, to, roles, lock scope, notes rule and notifications. Also `adminStatusAction`, `packingBlockers` (D7), `ITEM_WORK_STATES`, `CLOSED_ORDER_STATUSES`, `ACTIVE_DELIVERY_STATUSES` and `INITIAL_ORDER_STATUS`. |
| `engine.ts` | `runTransition(action, request)`. It validates the notes rule, then locks children before the order (§4). Next it checks ownership and state against the locked rows, then the role (**403 TRANSITION_NOT_PERMITTED_FOR_ROLE**), then the preconditions. Finally it applies the effects in the same transaction. |
| `status-writer.ts` | `setOrderStatus`, the **only** writer of `order_status`. It is a compare-and-set, and it always writes the history row. Also `recordOrderPlaced` and `updateOrderFields`. |
| `settlement.ts` | `settleCod`, the **one** COD settlement, used by rider collection and admin mark-delivered (D4). |
| `actions/{customer,store,rider,admin,shared}.ts` | The per-action checks and effects. |

**No-bypass guard:** `tests/order-lifecycle-guard.test.ts` statically fails the build if any file outside `lifecycle/` sets `order_status`, writes `order_status_history`, or runs raw `UPDATE orders`. It also fails if orders are inserted anywhere except order creation, which must take `INITIAL_ORDER_STATUS`.

### Transition catalogue

The customer sees `order_status`, `cancellation_reason`, and history as status and time only (D11).

| # | Action (route) | Order change | Delivery change | Roles | Error codes (in precedence order) | What the customer gets |
|---|---|---|---|---|---|---|
| 1 | CUSTOMER_CANCEL (`POST /orders/:id/cancel`) | PLACED/PACKED → CANCELLED | — | CUSTOMER (owner) | 404 ORDER_NOT_FOUND · 400 ORDER_ALREADY_OUT_FOR_DELIVERY · 400 ORDER_ALREADY_CANCELLED · 400 ORDER_CANNOT_BE_CANCELLED *(frozen)* | reason; ORDER_CANCELLED SMS |
| 2 | RESOLVE_ITEM (`resolve-item`, `PATCH …/items/:itemId`) | PLACED → ITEM_UNAVAILABLE (stays if already) | — | ADMIN, STAFF | 404 ORDER_ITEM_NOT_FOUND · **400 ORDER_NOT_IN_SOURCING_STATE, now for anything but PLACED/ITEM_UNAVAILABLE (D9)** · 409 ITEM_ALREADY_SOURCED · 409 ITEM_ALREADY_RESOLVED | new total; ITEM_UNAVAILABLE SMS |
| 3 | PACK (`PATCH …/status {PACKED}`) | PLACED/ITEM_UNAVAILABLE → PACKED; items SOURCED → PACKED (D8) | — | ADMIN, STAFF | 404 · 422 INVALID_STATUS_TRANSITION · 422 ORDER_NOT_PACKABLE `{pending, unsourced_substitutions, packable_items}` | status only |
| 4 | ASSIGN_RIDER (`POST …/assign-rider`) | unchanged (PACKED) | new ASSIGNED | ADMIN | 404 · **422** ORDER_NOT_READY_FOR_ASSIGNMENT (D1; was 409) · 404 RIDER_NOT_FOUND · 409 RIDER_INACTIVE · 409 ORDER_ALREADY_ASSIGNED | RIDER_ASSIGNED SMS (one per assignment) |
| 5 | HAND_TO_RIDER (`{OUT_FOR_DELIVERY}`) (D3) | PACKED → OUT_FOR_DELIVERY | ASSIGNED/ACCEPTED → PICKED_UP | ADMIN, STAFF | 404 · 422 INVALID_STATUS_TRANSITION · 422 NO_ACTIVE_DELIVERY · 409 ORDER_CHANGED | OUT_FOR_DELIVERY SMS (one per dispatch) |
| 6 | RIDER_PICKUP | PACKED → OUT_FOR_DELIVERY | → PICKED_UP | RIDER (owner) | 404 DELIVERY_NOT_FOUND · 409 ORDER_NOT_ACTIVE · 409 INVALID_DELIVERY_TRANSITION · 409 ORDER_NOT_READY_FOR_PICKUP *(frozen)* | as #5 |
| 7 | RIDER_ARRIVE | unchanged | PICKED_UP → ARRIVED | RIDER (owner) | *(frozen)* | — |
| 8 | RIDER_FAIL | OUT_FOR_DELIVERY → FAILED | → FAILED + reason | RIDER (owner) | 400 · *(frozen)* | FAILED |
| 9 | RIDER_COLLECT_COD | OUT_FOR_DELIVERY → DELIVERED/PAID | ARRIVED → DELIVERED | RIDER (owner) | 409 COD_ALREADY_COLLECTED · 409 ORDER_NOT_ACTIVE · 409 INVALID_DELIVERY_TRANSITION · 409 NOT_COD_ORDER · 400 INVALID_COD_AMOUNT *(frozen)* | DELIVERED + COD_PAYMENT_CONFIRMED SMS |
| 10 | ADMIN_MARK_DELIVERED (`{DELIVERED, notes}`) (D4) | OUT_FOR_DELIVERY → DELIVERED/PAID | active → DELIVERED (amount = locked total) | ADMIN | 400 notes · 404 · 422 · 422 NO_ACTIVE_DELIVERY · 409 COD_ALREADY_COLLECTED · 422 NOT_COD_ORDER | as #9 |
| 11 | ADMIN_MARK_FAILED (`{FAILED, notes}`) (D5) | OUT_FOR_DELIVERY → FAILED | active → FAILED (reason = notes) | ADMIN | 400 · 404 · 422 · 422 NO_ACTIVE_DELIVERY · 409 ORDER_CHANGED | FAILED (no note) |
| 12 | ADMIN_MARK_CUSTOMER_UNAVAILABLE (D5) | OUT_FOR_DELIVERY → CUSTOMER_UNAVAILABLE | as #11 | ADMIN | as #11 | CUSTOMER_UNAVAILABLE |
| 13 | ADMIN_CANCEL (`{CANCELLED, notes}`) (D10) | PLACED/ITEM_UNAVAILABLE/PACKED → CANCELLED | — (an assigned rider sees "Cancelled — don't pick up") | ADMIN | 400 · 404 · 422 | reason = notes; ORDER_CANCELLED SMS |
| 14 | RESTAGE (`{PACKED, notes}` from FAILED/CU) (D6 B) | FAILED/CUSTOMER_UNAVAILABLE → PACKED | none; the failed attempt must be closed | ADMIN | 400 · 404 · 422 · 422 ACTIVE_DELIVERY_EXISTS · 409 ORDER_CHANGED | PACKED again |

**Everything else on the admin status endpoint returns 422 INVALID_STATUS_TRANSITION** `{current_status, requested_status}`. That includes → PLACED, → ITEM_UNAVAILABLE, any change out of DELIVERED or CANCELLED, PLACED → OUT_FOR_DELIVERY, and a repeat of the same status. Order creation (PLACE_ORDER) takes its status and first history row from the lifecycle.

## 3. Bypasses closed (security fixes)

| Before | After |
|---|---|
| `PATCH /admin/orders/:id/status` set any of 8 statuses from any state, for staff and admin alike. That allowed DELIVERED without payment, reviving CANCELLED orders, and OUT_FOR_DELIVERY without a rider. | Only catalogue actions #3, #5 and #10–#14, split by role, with preconditions and side effects. |
| resolve-item could move a PACKED, **OUT_FOR_DELIVERY** or FAILED order back to ITEM_UNAVAILABLE and change the cash mid-delivery. It also wrote no history row. | Allowed only on PLACED/ITEM_UNAVAILABLE (D9). It writes a history row on PLACED → ITEM_UNAVAILABLE. |
| Sourcing was allowed on any order that wasn't cancelled or delivered. | Uses the same `ITEM_WORK_STATES`. |
| Admin cancel didn't set the cancellation fields or notify the customer. | It does both (D10). |
| Admin FAILED left the delivery "active", which blocked reassignment. | It closes the attempt (D5). |
| Staff notes reached the customer through `history[].reason_or_notes`. | The customer's history has status and time only (D11). |
| Malformed ids on admin order detail, status and assign, and on customer detail and cancel, returned **500**. | They return 400 VALIDATION_ERROR. |
| **Checkout could fail with 500.** Order numbers are `BL-<date>-<4 random digits>` under a UNIQUE constraint; at ~50 orders a day a same-day collision is ~13%. Found as an intermittent test failure and root-caused from the server log (`orders_order_number_key`). | A bounded retry with a fresh number, on that constraint only. The format is unchanged. |

## 4. Locking and concurrency

**Rule:** lock children before the order, and the payment after the order. The child is one item, all of an order's items by id, the rider's delivery, or the order's active deliveries by id. No action locks both items and deliveries.

The active-deliveries set is re-read after the order lock. If it changed, the action returns 409 ORDER_CHANGED rather than locking in the wrong order. Assignment only *inserts* a delivery.

Concurrency tests (`tests/order-lifecycle.test.ts`): each race runs 5 times, with no deadlock and no 500, and must end in a consistent state:

| Race | Result |
|---|---|
| pack ∥ pack | 200 + 422 |
| pack ∥ customer cancel | history is PLACED→PACKED→CANCELLED or PLACED→CANCELLED |
| pack ∥ sourcing the last item | never PACKED with an item still PENDING |
| pack ∥ resolve | totals match the status |
| assign ∥ assign | 200 + 409 |
| assign ∥ customer cancel / admin cancel | CANCELLED, at most one waiting delivery |
| admin cancel ∥ rider pickup | exactly one wins |
| hand-to-rider ∥ rider pickup | one dispatch, one SMS |
| admin FAILED ∥ rider collect | DELIVERED+PAID or FAILED+PENDING, never a mix |
| admin DELIVERED ∥ rider collect | exactly one settlement |
| restage ∥ assign | no assignment on a FAILED order |
| customer cancel ∥ rider pickup | existing rider-delivery test |

## 5. API changes

- **`PATCH /admin/orders/:id/status`:** now the catalogue mapping, with a uuid param.
- **`GET /admin/orders`:**
  - `status` accepts a comma list, and a `since` filter was added;
  - each row has `items_summary` and `active_delivery {id, assignment_status, rider_id, rider_name}`;
  - two grouped queries per page, not N+1.
- **`GET /admin/orders/:id`:** uuid param; `delivery.rider_name`.
- **`GET /admin/riders` (ADMIN, documented, new):** active riders with `open_deliveries` counted from real rows. No availability flag.
- **`POST /admin/orders/:id/assign-rider`:** not PACKED → 422 (was 409); uuid param.
- **resolve-item and sourcing:** D9 eligibility, with the same 400 code.
- **`GET /orders` (customer):** each order includes its `items`, sanitized with no costs.
- **`GET /orders/:id` (customer):** history is `{id, order_id, old_status, new_status, created_at}`; uuid param. `POST /orders/:id/cancel` also got a uuid param.
- **Notification keys:** RIDER_ASSIGNED and OUT_FOR_DELIVERY are now keyed per delivery, so a replacement rider after a re-stage is announced.

**Database: no migration, no new state or column.** Item-level `PACKED`, an existing enum value, is now written (D8).

## 6. UI changes

**Admin app** (the house style is unchanged; the Orders board is new):
- **Access.** PACKING_STAFF can sign in and see **Orders** only. Catalog and promotions redirect to Orders (and remain ADMIN-only in the API). ADMIN gets Dashboard, Orders, Products, Categories and Promotions.
- **Orders board ("the pass").** Time-ordered rows grouped by the next step: **Needs attention** (item unavailable, failed, customer unavailable) · **To pack** · **Ready for a rider** · **Waiting for pickup** · **On the road** · **Done today** (a count line).
- **Row content.** Each row shows the order number, destination, progress ("2 of 3 sourced"), the rider, the documented **Scheduled 08:00** label (D15), the real age since placed, the total, and **one** yellow next step for the signed-in role. Where sourcing is incomplete it shows "Source in Inventory".
- **Order panel.** Items by name, quantity and status (no costs or suppliers), the customer's call link, the address and note, the rider, the history with staff notes, and the actions allowed to this role in this state.
- **Dialogs.**
  - *Assign rider:* lists active riders with their vehicle and open deliveries.
  - *Cancel:* asks for a reason, labelled "shown to the customer".
  - *Mark delivered:* states the cash amount it will record.
  - *Mark failed / Customer unavailable / Return to packed:* ask for a note.
- **Refusals.** Every API refusal is shown in plain words and the board re-reads. It refreshes every 20 s while visible and when the tab returns. Double clicks send one request.

**Customer app (Flutter):**
- The whole order row opens the detail (previously only the arrow did).
- The detail shows a **Status** line, using the same labels as the list (shared in `Models/order_status_labels.dart`).
- There is no other change.

**The Rider app is unchanged.** The API keeps its behaviour and error codes, and the rider-delivery tests pass 38/38.

**Design audit (7 findings), fixed in the visual layer:**
1. Rows collapsed when the panel opened (truncated address, stacked flag). They now reflow, and the age column hides.
2. The selected row was tinted yellow. It now uses a neutral canvas with an ink rule; yellow is reserved for the next step.
3. Money was in monospace ("Rs.  1,415"). It now uses Catamaran tabular figures; monospace is kept for order numbers and clock times.
4. The phone link's yellow underline stretched across the panel. It now underlines the number only.
5. History repeated itself ("Packed / Packed"). Notes identical to the status are hidden.
6. Out-for-delivery actions had unequal weights. Only Cancel keeps the ink outline.
7. The re-stage row label was too long. It is now "Return to packed".

All tests and the live E2E passed again after the changes.

## 7. Verification

| Suite | Result |
|---|---|
| Backend (Vitest + supertest, real Postgres) | **629/629**, 23 files. New: order-lifecycle-catalogue (183), order-lifecycle (48), order-lifecycle-guard (4), dispatch-reads (8), customer-orders (3), order-number (2). tsc + build clean. |
| Admin | **65/65** (new: access 7, orders-lib 29, orders 14). tsc + build clean; no dev skip in the bundle. |
| Inventory | 58/58, tsc + build clean (unchanged) |
| Rider | 49/49, tsc + build clean (unchanged) |
| Customer (Flutter) | **188/188** (new: orders_screen_test 4). `flutter analyze` clean on the changed files. |

**Live E2E** (`scratchpad/e2e/dispatch_live.cjs`): real OTP sign-ins, the Admin board in Edge at 1366×900 for staff and admin, the Rider app in Pixel 7 emulation, and a DB check after each step. **42/42**, run twice (before and after the visual refinement), with the database restored to baseline both times:
- **Happy path.**
  1. The customer orders two items.
  2. The board shows "0 of 2 sourced" with no Pack button, and the API refuses a pack (422).
  3. The items are sourced; staff click **Pack** (DB: PACKED, items PACKED, one history row by the packer).
  4. The admin assigns from the dialog, which lists only the active rider (DB: ASSIGNED). A duplicate assignment gets 409.
  5. The rider picks up, arrives and collects. DB: DELIVERED/PAID; history PLACED→PACKED→OUT_FOR_DELIVERY→DELIVERED.
  6. The customer API shows 2 items and no notes.
- **Failure and recovery.**
  1. The admin marks failed with a note (DB: FAILED, the delivery holds the note). The customer can't see the note.
  2. The admin chooses **Return to packed** (history FAILED→PACKED by the admin).
  3. The admin reassigns (the failed attempt is kept, plus a new ASSIGNED delivery).
  4. The rider delivers. DB: DELIVERED/PAID; history …→FAILED→PACKED→OUT_FOR_DELIVERY→DELIVERED.
  5. Messages: 2 RIDER_ASSIGNED, 2 OUT_FOR_DELIVERY, 1 DELIVERED.
- **Hand-over.** Staff click **Handed to rider** (DB: OUT_FOR_DELIVERY, delivery PICKED_UP). The Rider app opens at "I've arrived", and the order is delivered.
- **Live negative checks.** Staff cancel → 403; invalid transitions → 422; assign on PLACED → 422; re-staging a DELIVERED order → 422; resolve on DELIVERED → 400; malformed id → 400; customer/rider/staff on admin-only routes → 403; cancel without a reason → 400; admin cancel with a reason → CANCELLED with the customer-visible reason.
- **Customer app, checked by hand.** "Your Orders" showed "2 items · Rs.1415" with Delivered and Cancelled statuses. Tapping the row body opened the detail with **Status: Delivered**.

## 8. Remaining limitations

- **Pre-existing test leak.** `tests/notifications.test.ts` leaves 19 order-less notifications unless `orders.test.ts` runs after it. They were removed with the guarded script before the E2E; the test is unchanged.
- **Stock on cancellation.** Stock isn't restored when an order with TRACKED, sourced items is cancelled (`ORDER_CANCELLATION_RESTORE` is unused). That is Inventory's domain and was not in scope.
- **Substitutions.** There is no "add substitution item" endpoint (§K Scenario B). A SUBSTITUTED item must be sourced before the order can be packed.
- **Pack after cancel.** A customer can still cancel a PACKED order (D2, per the PRD). An order packed and then cancelled keeps its items PACKED.
- **No push.** The board and the Rider app poll (20 s / 30 s) and refresh on focus.
- **Unused dev field.** The seeded `riders.is_available` is shown nowhere and changed by nothing (no availability system).
- **Order-number date.** The order number's date is UTC. Orders placed 00:00–05:30 in Colombo carry the previous date. This is pre-existing and unchanged.
- **External harness.** The live E2E harness lives outside the repo.
