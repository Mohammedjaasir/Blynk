# Blynk Dispatch & Order Operations Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the order-lifecycle bypasses the Rider work exposed. Every endpoint that changes an order's status must enforce the documented state machine server-side, under consistent locks. Also give staff a packing and rider-assignment workflow, settle failed-delivery recovery, and fix the two real Customer Orders bugs.

**Architecture:** Enforcement lives in the existing Express modules (`orders`, `inventory`, `riders`) behind the existing routes. No new states, no migration, no new app. The staff-facing Orders workflow goes into the **Admin app**, which the PRD and architecture name as the "admin/staff dashboard" for packing queues and manual rider assignment (decision D12). Inventory keeps stock, sourcing, suppliers and adjustments. The Rider workflow is frozen.

**Tech Stack:** Node/TS Express + Kysely + Postgres + zod; Vitest + supertest against the dev DB. Admin: React 18 + Vite 5 + TS, plain CSS, Vitest + Testing Library. Customer: Flutter (Provider). Live E2E: playwright-core (Edge) + direct Postgres checks.

**Spec:** the user's "Next phase: Blynk Dispatch & Order Operations Hardening" message (2026-09-19). Canonical sources:
- `docs/01-product/blynk_prd.md` §2, §3.4, §3.6, §4
- `docs/04-business/business-rules.md` §5, §7
- `docs/02-architecture/blynk_backend_api_architecture.md` §G (matrix), §H (assignment), §I (COD), §K (out-of-stock), status-code mapping
- `docs/02-architecture/blynk_architecture.md` §8 (state machine, "Invalid transitions rejected with HTTP 422"), §10–11 (rider/admin flows)

## Global Constraints

- Do not modify the Rider workflow or add Rider features (Rider endpoints, app and rules stay as shipped).
- Do not invent order or delivery states. Only the existing enums.
- Preserve business rules. Where the docs conflict, stop and ask (the conflicts are listed in §C).
- The server enforces every rule. The UI is never the protection.
- Inventory owns stock, sourcing, suppliers and adjustments. Dispatch only reads order information.
- No automatic dispatch, no rider self-assignment, no invented availability system, no WebSockets, Redis, queues or microservices.
- No fake data, fake analytics or decorative charts. Real API data only.
- Customer app: fix only the two confirmed bugs (plus D14 if approved). No redesign.
- Colours: `#FFE141` for the primary action only; `#0C831F` for success only; never green-dominant; never coral or red as a brand colour.
- Test-first for every backend change. Tests and the live E2E leave the database exactly at its pre-run baseline.
- Commit nothing unless asked.

---

## A. Requirements (what this phase must deliver)

1. Every order-status write path enforces the documented transitions, with deterministic HTTP and error codes, under transaction-safe locks, backed by concurrency tests.
2. A staff packing workflow: see what's ready, see why an order can't be packed yet, pack it.
3. An admin rider-assignment workflow on top of the hardened `assign-rider` API: only PACKED orders, only active riders.
4. A documented answer to failed-delivery recovery (§G), implemented only after approval.
5. Customer Orders: the list shows the real item count, and tapping an order opens its detail. The lifecycle PLACED → PACKED → OUT_FOR_DELIVERY → DELIVERED, plus cancelled and failed, reads correctly to the customer.
6. Full verification: backend, affected apps, typechecks, builds, and a live E2E customer → packing → assignment → rider → delivery → customer, with the database restored.

---

## B. Audit: every code path that writes `orders.order_status`

| # | Path | Route / roles | Today | Bypass? |
|---|---|---|---|---|
| 1 | `createOrderAtomic` | `POST /orders` (auth) | inserts PLACED | no |
| 2 | `cancelOrder` | `POST /orders/:id/cancel` (customer, own order) | locks order, PLACED/PACKED → CANCELLED (Rider phase R9) | no (see C1/C2) |
| 3 | **`updateOrderStatus`** | **`PATCH /admin/orders/:id/status` (ADMIN, PACKING_STAFF)** | locks order, then sets **any** of 8 statuses from **any** state. No role split, preconditions or side effects. | **YES, critical.** Examples: DELIVERED → PLACED; CANCELLED → PACKED; PLACED → PACKED with unsourced items; staff sets DELIVERED (payment stays PENDING, delivery row stays PICKED_UP); OUT_FOR_DELIVERY set without a rider (the rider's pickup then fails); FAILED set while the delivery stays "active", which blocks reassignment. Admin CANCELLED doesn't set `cancellation_reason`/`cancelled_by`/`cancelled_at` or notify. |
| 4 | **`resolveUnavailableItem`** | `POST /admin/orders/:id/resolve-item`, `PATCH …/items/:itemId` (ADMIN, STAFF) | locks item → order and refuses only CANCELLED/DELIVERED, then **always sets ITEM_UNAVAILABLE** | **YES.** A PACKED, **OUT_FOR_DELIVERY**, FAILED or CUSTOMER_UNAVAILABLE order can be dragged back to ITEM_UNAVAILABLE, with total and COD recalculated mid-delivery. The matrix allows only PLACED → ITEM_UNAVAILABLE. |
| 5 | `sourceOrderItemAtomic` | `POST /admin/orders/:id/items/:itemId/source` | doesn't write the order status; refuses only CANCELLED/DELIVERED | indirect: a PENDING or SUBSTITUTED item can be sourced after the order has left the packing stage |
| 6 | rider `updateDeliveryStatus` | `PATCH /riders/deliveries/:id/status` | guarded (Rider phase) | no |
| 7 | rider `collectCod` | `POST /riders/deliveries/:id/collect-cod` | guarded (Rider phase) | no |
| 8 | `assignRider` | `POST /admin/orders/:id/assign-rider` (ADMIN) | guarded; doesn't change the order status | no; codes differ from the docs (C6) |

Other gaps found:
- `GET/PATCH/POST /admin/orders/:id…` don't validate `:id`, so a malformed id → **500**.
- Item-level `PACKED` exists in the enum but is never written.
- `ORDER_CANCELLATION_RESTORE` exists but nothing restores stock when an order is cancelled (Inventory's domain; flagged, not in scope).
- The documented `GET /admin/riders` (ADMIN) isn't implemented.

## C. Documentation conflicts (decisions needed; I don't choose silently)

| # | Conflict | Sources | Recommendation |
|---|---|---|---|
| C1 | **Customer cancelling a PACKED order.** Both transition tables say `PACKED → CANCELLED` is **ADMIN only** ("ops emergency"). PRD §2/§3.6, business-rules §5 and backend_api checklist line 995 say customer cancel is allowed **until OUT_FOR_DELIVERY** ("Allowed in PLACED and PACKED"). The code follows the PRD. | matrix vs PRD / business rules | **Keep current behaviour** (customer may cancel PLACED/PACKED). No change this phase (Rider-phase instruction). |
| C2 | **Customer cancelling an ITEM_UNAVAILABLE order.** The backend_api matrix says `ITEM_UNAVAILABLE → CANCELLED` by **CUSTOMER, ADMIN**; §K Scenario C does it via the admin endpoint. The customer endpoint refuses ITEM_UNAVAILABLE. | matrix vs code | **Keep current** (customer refused; admin cancels after phoning the customer, per §K). Flag for a later product decision. |
| C3 | **Who moves PACKED → OUT_FOR_DELIVERY.** Both tables: PACKING_STAFF, ADMIN, "rider assigned and dispatched". blynk_architecture §11 even says "Assign rider (PACKED → select rider → OUT_FOR_DELIVERY)". PRD §3.4, backend_api §H and the shipped Rider app: assignment leaves the order PACKED, and the **rider's pickup** moves it to OUT_FOR_DELIVERY. | tables / §11 vs PRD / §H / Rider | See **D3**. Assignment stays non-dispatching (Rider frozen). |
| C4 | **ADMIN marking DELIVERED.** The matrix allows RIDER, ADMIN with the condition "COD cash collected". §I says payment becomes PAID only through the rider's cash confirmation. Today an admin DELIVERED leaves the payment PENDING and the delivery PICKED_UP. | matrix vs §I | See **D4**. |
| C5 | **Failed-delivery recovery.** PRD §3.6, business-rules §7 and backend_api §H say that after a failed or rejected attempt "a replacement rider can be assigned immediately". But: both state tables make `OUT_FOR_DELIVERY → FAILED/CUSTOMER_UNAVAILABLE` with **no outgoing transition**; §H.1 says assignment requires a PACKED order; and the shipped Rider failure sets the **order** FAILED. The docs don't resolve it. | PRD / rules / §H vs state tables / §H.1 / Rider | **Needs your decision** (§G). |
| C6 | **Status codes.** blynk_architecture §8: invalid transitions → **422**; assign-rider "422 Order not in PACKED status", "409 Rider not available". backend_api mapping: 422 = business rule (`INVALID_STATUS_TRANSITION`), 409 = state violation / unique conflict. Shipped: assign 409 `ORDER_NOT_READY_FOR_ASSIGNMENT`; rider 409s; sourcing/resolve 400 `ORDER_NOT_IN_SOURCING_STATE`. | docs vs code | See **D1**. |
| C7 | **"Override order status if needed"** (blynk_architecture §11 admin flow) vs "DELIVERED/CANCELLED → any state rejected (422)" (§8). | §11 vs §8 | Read "override" as "admin performs any matrix transition allowed to ADMIN". No free-form override. |
| C8 | **Substitution.** §K Scenario B: "Staff adds substitution item to order; original marked SUBSTITUTED". There is no endpoint to add an item. Resolve-item marks SUBSTITUTED but keeps the original price in the total, and sourcing later turns it SOURCED. | §K vs code | Don't build "add item" (not requested). Packability rule in **D7**. |
| C9 | blynk_architecture §8 lists **no** transitions out of ITEM_UNAVAILABLE. backend_api §G/§K list `ITEM_UNAVAILABLE → PACKED` (STAFF, ADMIN) and `→ CANCELLED`. | omission | Follow backend_api §G/§K (more specific). |
| C10 | "409 Rider not available" and an "I'm available" toggle are documented. No availability system exists (`riders.is_available` has no writer). | docs vs code | **No availability logic.** Only `is_active` gates assignment (as shipped). Don't display `is_available`. |

## D. Proposed server-side state machine (after decisions)

All order-status changes go through **exactly one** guard: `orders/order.transitions.ts`, a pure table plus preconditions. The existing routes call it.

### D.1 `PATCH /admin/orders/:id/status` — `{ status, notes? }`

| From | To | Roles | Preconditions (server) | Side effects (same transaction) |
|---|---|---|---|---|
| PLACED, ITEM_UNAVAILABLE | **PACKED** | ADMIN, PACKING_STAFF | D7: no PENDING item; every SUBSTITUTED item sourced; ≥1 item SOURCED/PACKED | D8: items SOURCED → PACKED; `packed_at`; history |
| PACKED | **OUT_FOR_DELIVERY** | per D3 | per D3 | per D3 |
| OUT_FOR_DELIVERY | **DELIVERED** | ADMIN (D4) | active delivery PICKED_UP/ARRIVED; COD; payment PENDING; `notes` required | same settlement as rider collect-cod (delivery DELIVERED, `cod_collected_amount` = locked total, payment PAID, order DELIVERED/PAID, history, DELIVERED + COD_PAYMENT_CONFIRMED SMS with the same idempotency keys) |
| OUT_FOR_DELIVERY | **FAILED**, **CUSTOMER_UNAVAILABLE** | ADMIN (D5) | active delivery PICKED_UP/ARRIVED; `notes` required | active delivery → FAILED, `failure_reason = notes`, `failed_at`; history |
| PLACED, ITEM_UNAVAILABLE, PACKED | **CANCELLED** | ADMIN (D10) | `notes` required (becomes the customer-visible `cancellation_reason`) | `cancellation_reason`, `cancelled_by_user_id`, `cancelled_at`; history; ORDER_CANCELLED SMS (same key as customer cancel); an ASSIGNED delivery is left as is (the Rider app already shows "Cancelled — don't pick up") |
| FAILED, CUSTOMER_UNAVAILABLE | per **D6** | | | |
| anything else (incl. same-state repeats, DELIVERED/CANCELLED → anything, any → PLACED, any → ITEM_UNAVAILABLE) | — | — | — | **422 `INVALID_STATUS_TRANSITION`** `{ current_status, requested_status }` |

- A role not allowed for an otherwise valid transition (e.g. staff → CANCELLED) → **403 `TRANSITION_NOT_PERMITTED_FOR_ROLE`**.
- A precondition failure: **422** `ORDER_NOT_PACKABLE` `{ pending, unsourced_substitutions, packable_items }`, `NO_ACTIVE_DELIVERY`, `NOT_COD_ORDER`, or `COD_ALREADY_COLLECTED` (409, matching the rider API).
- **409 `ORDER_CHANGED`**: the delivery set changed while locks were being taken (see §I). The client re-reads.
- ITEM_UNAVAILABLE can be reached only through resolve-item, because it needs an item.

### D.2 resolve-item and sourcing (D9)
Both require the order in **PLACED or ITEM_UNAVAILABLE**. Otherwise the existing **400 `ORDER_NOT_IN_SOURCING_STATE`**, keeping the Inventory contract and its UI message. This closes bypass #4 and makes #5 harmless.

### D.3 assign-rider (D1)
`order_status !== PACKED` → **422 `ORDER_NOT_READY_FOR_ASSIGNMENT`** (was 409; the docs say 422). The other codes are unchanged: 404 RIDER_NOT_FOUND, 409 RIDER_INACTIVE, 409 ORDER_ALREADY_ASSIGNED.

## E. Packing workflow

| Question | Answer (from code + docs) |
|---|---|
| Endpoint | The existing `PATCH /admin/orders/:id/status {status:'PACKED'}`. No new endpoint. |
| Roles | ADMIN, PACKING_STAFF (both tables). |
| Packable | D7: status PLACED or ITEM_UNAVAILABLE; no PENDING item; no SUBSTITUTED item still unsourced (§G "actual procurement cost recorded"); at least one item SOURCED/PACKED (otherwise it's an empty bag: cancel instead). |
| Unavailable items | Already removed from totals by resolve-item (§K). They don't block packing. §K's "dispatch gate" holds because totals are always recalculated in the same transaction. |
| Order changes during packing | The server re-checks everything under the locks. If sourcing, resolve or cancel landed first, pack returns 422 `ORDER_NOT_PACKABLE`, 422 `INVALID_STATUS_TRANSITION` or 409, and the UI re-reads the order and says what changed. |
| Concurrency | Items locked (by id) then order. Sourcing and resolve lock item then order. Customer cancel locks the order only. No cycle (§I). Double pack → 200 then 422 `INVALID_STATUS_TRANSITION`. |
| Inventory boundary | Dispatch shows item name, quantity and status read-only, and links staff to the Inventory app for sourcing. It never sources, adjusts or touches stock or suppliers. |

## F. Rider assignment workflow

- **API:** the existing, hardened `POST /admin/orders/:id/assign-rider` (ADMIN), plus the documented but missing **`GET /admin/riders`** (ADMIN, D13). It returns **active** riders only: `id, full_name, phone, vehicle_type, vehicle_registration_number, open_deliveries` (count of that rider's ASSIGNED/ACCEPTED/PICKED_UP/ARRIVED deliveries — real data, not an availability flag).
- **UI:** only PACKED orders with no active delivery show "Assign rider". The picker lists `GET /admin/riders`. On 409 `ORDER_ALREADY_ASSIGNED` / 422 / 404 the UI re-reads and explains. There is no automatic dispatch, no self-assignment, and staff can't assign (the button is hidden for PACKING_STAFF and the API returns 403).
- **Where it lives (D12):** the Admin app. The PRD §4 calls it "Admin/Staff Dashboard — packing queues … manually assign riders", and blynk_architecture §11 puts "Pack order / Assign rider" in the admin dashboard. The alternatives:
  - **Inventory app:** breaks your Inventory scope rule, and its "no Rider in Inventory" constraint.
  - **A new ops app:** you said not to create one for convenience.

  Consequence: the Admin app must admit **PACKING_STAFF**, with an Orders-only nav. Catalog, Promotions and Dashboard stay ADMIN-only in the UI and remain ADMIN-guarded by the API. The Admin "scope" test (exactly 4 nav links, no "delivery/rider" text) gets updated deliberately.

## G. Failed-delivery recovery (C5) — **APPROVED: Option B**

| Option | What happens | Consequences |
|---|---|---|
| **A. Terminal** | FAILED and CUSTOMER_UNAVAILABLE stay final. Recovery = the customer re-orders (or admin re-creates it outside the system). | Literal to both state tables and §H.1. Contradicts "a replacement rider can be assigned immediately" (PRD, business rules §7, backend_api §H). No code beyond D5. |
| **B. Admin re-stage** (recommended) | New **transition** (not a new state): `FAILED` / `CUSTOMER_UNAVAILABLE` → `PACKED`, ADMIN only, notes required, and only if no active delivery exists (the failed one is closed). Then the normal assign flow picks a replacement rider. | Meets the documented reassignment intent. Keeps §H.1 (assign requires PACKED) and the frozen Rider workflow. The customer sees `FAILED → PACKED → OUT_FOR_DELIVERY` in the status and history. It adds an edge the state tables don't draw. |
| **C. Assign directly from FAILED** | assign-rider accepts FAILED/CUSTOMER_UNAVAILABLE orders; rider pickup moves FAILED → OUT_FOR_DELIVERY. | Changes the Rider pickup rules (you froze Rider) and breaks §H.1. |
| **D. Rider failure no longer fails the order** | A rider failure sets the delivery FAILED and returns the order to PACKED. | Changes the shipped Rider behaviour and contradicts `OUT_FOR_DELIVERY → FAILED` (RIDER). |

**I will not implement any recovery until you choose.** Task 6 is written for Option B and is skipped under A.

## H. Customer Orders (audit results)

| Issue | Root cause (verified) | Fix |
|---|---|---|
| "0 items" | `GET /orders` → `findCustomerOrders` selects only `orders` columns, so `items` is missing and the Flutter model sums `[]` = 0 (`user_orders_screen.dart:112-113`). | Backend: the list includes each order's items (one extra `WHERE order_id IN (…)` query, not N+1), sanitized like the detail view (no costs). The Flutter code is already correct. |
| Tapping an order does nothing | The row `Container` has no onTap. Only the small trailing arrow `IconButton` navigates to `/order` (L170-175), and it works. | Flutter: wrap the row in an `InkWell` calling the same `pushNamed('/order', arguments: order.id)`. Keep the arrow. No restyle. |
| (D14) The detail screen never shows the order status | `OrderSummaryScreen` → `card_order_details.dart` shows the number, payment, address, date and the cancel/cancellation reason, but not the status. | **Optional:** one status line using the list's existing label map. Needed for "the lifecycle appears correctly" in the detail. Your call. |

Lifecycle check: `order_model.dart` maps all 8 statuses. The list labels them (Placed / Packed / Out for delivery / Delivered / Cancelled / Failed / Customer unavailable / Item unavailable). The E2E verifies each stage with a real order.

## I. Locking strategy (deadlock analysis)

**Rule: lock child rows (order_items *or* deliveries) before the order row; the payment row after the order. Never lock a child after its order.**

| Path | Lock order |
|---|---|
| sourcing, resolve-item | item → order (existing) |
| **pack** (new) | all the order's items `ORDER BY id FOR UPDATE` → order |
| rider status, collect-cod | delivery → order → payment (existing) |
| **admin DELIVERED / FAILED / CU / dispatch** (new) | the order's active deliveries `ORDER BY id FOR UPDATE` → order → payment |
| admin CANCELLED, customer cancel, assign-rider | order only (assign then *inserts* a delivery; that takes no lock on existing rows) |

- **No path locks both items and deliveries.** Every path ends at the order, so no wait cycle is possible.
- **Delivery set changing under the lock.** The admin path locks the deliveries it can see, then the order, then re-reads the active deliveries. If a new one appeared in between (a concurrent assign), it returns **409 `ORDER_CHANGED`** rather than locking the new delivery after the order (which would invert the order).
- **Tests.** A lock-order test runs each pair of conflicting paths 5× concurrently and asserts no Postgres `40P01` (deadlock) and a consistent final state.

## J. Security & concurrency test matrix (backend, `tests/order-operations.test.ts`)

- **Roles:**
  - CUSTOMER and RIDER → 403 on every `/admin/orders*` and `/admin/riders` route.
  - PACKING_STAFF → 403 on CANCELLED, DELIVERED, FAILED, CUSTOMER_UNAVAILABLE and assign.
  - ADMIN is allowed per D.1.
- **IDOR / ids:**
  - Malformed order id → 400 on detail, status and assign.
  - Unknown order → 404.
  - Unknown or malformed `rider_id` → 404 / 400.
  - An inactive rider → 409.
  - Rider B's token can't touch anything admin.
- **Invalid transitions (table-driven):** every (from, to) pair not in D.1 → 422 `INVALID_STATUS_TRANSITION`, with the DB unchanged. Same-state repeats → 422.
- **Preconditions:**
  - Pack with PENDING → 422; with an unsourced SUBSTITUTED item → 422; all-unavailable → 422.
  - DELIVERED without an active picked-up delivery → 422.
  - FAILED/CU/DELIVERED without notes → 400.
- **Duplicate requests:** double pack; double cancel; double admin DELIVERED → 200 + 422 (or 409), with one history row and one SMS each.
- **Races (5 repetitions each, no deadlock, consistent end state):**
  - pack ∥ pack
  - pack ∥ customer cancel
  - pack ∥ sourcing of the last item
  - pack ∥ resolve-item
  - assign ∥ assign
  - assign ∥ customer cancel
  - assign ∥ admin cancel
  - customer cancel ∥ rider pickup (existing)
  - admin cancel ∥ rider pickup
  - admin FAILED ∥ rider collect-cod
  - admin DELIVERED ∥ rider collect-cod (exactly one settlement)
- **Bypass regressions:**
  - resolve-item on PACKED/OUT_FOR_DELIVERY/FAILED → 400, with the total unchanged.
  - Sourcing on PACKED → 400.
  - Admin OUT_FOR_DELIVERY with no rider → 422.
  - Admin FAILED closes the delivery, so reassignment isn't blocked by a stale active row.
- **Customer:**
  - The list has items (no costs).
  - The history has no staff notes (D11).
  - Status and history read correctly after each stage.

## K. API changes (all on existing routes except the documented `GET /admin/riders`)

| Endpoint | Change |
|---|---|
| `PATCH /admin/orders/:id/status` | D.1 guard, role split, preconditions, side effects, codes; uuid param |
| `GET /admin/orders` | `status` accepts a comma list; each order gains `items_summary {total, pending, sourced, packed, unavailable, substituted}` and `active_delivery {id, assignment_status, rider_id, rider_name} \| null` (additive; the Inventory queue is unaffected) |
| `GET /admin/orders/:id` | uuid param; `delivery.rider_name` (additive) |
| `POST /admin/orders/:id/assign-rider` | not PACKED → 422 (was 409); uuid param |
| `POST /admin/orders/:id/resolve-item`, `PATCH …/items/:itemId`, `POST …/source` | order must be PLACED/ITEM_UNAVAILABLE (existing 400 code) |
| `GET /admin/riders` (ADMIN) | **new, documented** — active riders + open delivery count |
| `GET /orders` (customer) | orders include `items` (sanitized) |
| `GET /orders/:id` (customer) | D11: `history[]` loses `reason_or_notes` and `changed_by_user_id` |
| Option B only | `FAILED`/`CUSTOMER_UNAVAILABLE → PACKED` on the status endpoint |

**Database:** no migration, no new columns or states. Item-level `PACKED` (an existing enum value) starts being written (D8).

## L. UI / visual direction (Admin app → "Orders")

**Skill:** `ui-ux-pro-max` (Taste isn't installed; same as the previous phases). Its UX rules were applied: loading/submit feedback, confirmation for irreversible actions, no colour-only meaning, 44px targets on touch screens, keyboard access.

**Concept: "the pass"** — a restaurant-kitchen pass rather than a SaaS dashboard: one time-ordered rail of live orders grouped by what has to happen next. It stays in the Admin design language (white surface on `#F6F7F9` canvas, ink `#12151F`, Catamaran, 4px radii) but is distinct from Customer (bright consumer) and Rider (paper slip):
- **Lanes, in operational priority:**
  1. **Needs attention** (ITEM_UNAVAILABLE, FAILED, CUSTOMER_UNAVAILABLE)
  2. **To pack** (PLACED, with `2/3 sourced` progress from `items_summary` and a "Scheduled 8:00" tag when `scheduled_for` is set, as documented)
  3. **Ready for a rider** (PACKED, unassigned)
  4. **Waiting for pickup** (PACKED + assigned)
  5. **On the road** (OUT_FOR_DELIVERY)
  6. **Done today** (a count line, collapsed)
- **Rows, not cards:** `#number` in JetBrains Mono · age since placed (real `placed_at`, e.g. "23 min"; no SLA colours, no ETAs) · items progress · total · rider · **one primary action** in yellow (Pack / Assign rider). Oldest first within a lane.
- **Order panel** (right side on desktop, full screen under 900px): items with status (read-only; "Source in Inventory →" link when anything is pending); recipient name and phone (staff call customers per §K); address; history; and the actions allowed to this role in this state. Reasons are required where D.1 says so; the cancellation reason is labelled "Shown to the customer". Destructive actions (Cancel, Mark failed, Mark delivered) are confirmed in a dialog restating the consequence.
- **Exceptions:** ink-bold text with a "!" glyph and a left rule. No red, no charts, no metric tiles, no skeleton shimmer. Motion ≤150ms for the panel only; reduced-motion respected.
- **Freshness:** re-read on focus/visibility and every 20s while visible (the Rider pattern), plus after every action. Every 409/422 is shown in plain words and the order re-read.

---

## M. Decisions — APPROVED 2026-09-19

D1–D15 approved as recommended. **D6 = B (admin re-stage).** The user added three precisions:
- **D3:** "Handed to rider" atomically marks the assigned delivery PICKED_UP, so the Rider app opens at "I've arrived".
- **D4:** one authoritative transactional cash settlement shared by rider collection and admin mark-delivered. No duplicated settlement logic.
- **D6:** FAILED → PACKED is an explicit, documented, ADMIN-only transition, with no new state. Option B as proposed also covers CUSTOMER_UNAVAILABLE → PACKED; an admin sets that state for the same kind of failed attempt.

The previously approved Rider workflow, and every Rider error code and precedence, are preserved.

---

## O. Canonical order lifecycle (supersedes D.1–D.3; every status change goes through it)

### O.1 Mechanism

`backend/api/src/modules/orders/lifecycle/` is the **only** code allowed to change `orders.order_status` or write `order_status_history`.

| File | Responsibility |
|---|---|
| `catalogue.ts` | The transition catalogue as data: one entry per **action**, with `from`, `to`, `roles`, `lock`, `notesRequired`, customer-facing history text and notifications. Tests and the docs read it. |
| `engine.ts` | `runTransition(action, request)`. It opens the transaction, takes the locks in canonical order (§O.3), checks ownership, role, current state and preconditions **against the locked rows**, runs the action's effects, and is the sole caller of `setOrderStatus()`. |
| `status-writer.ts` | `setOrderStatus(trx, lockedOrder, to, actor, note, extra)`: a compare-and-set `UPDATE orders … WHERE id = $1 AND order_status = $locked` plus the history row. `extra` is typed so it cannot contain `order_status`. It also exports `recordOrderPlaced()` for the initial history row. |
| `settlement.ts` | `settleCod(trx, { delivery, order, amount, actor, note })`: the one COD settlement (delivery DELIVERED + amount, payment PAID, order DELIVERED/PAID via `setOrderStatus`, DELIVERED + COD_PAYMENT_CONFIRMED notifications). Used by `RIDER_COLLECT_COD` and `ADMIN_MARK_DELIVERED` (D4). |
| `actions/*.ts` | Per-action `check` (which error codes, in what order) and `apply` (effects), grouped by caller: `customer.ts`, `store.ts`, `rider.ts`, `admin.ts`. |

Endpoints (controllers → services) do request validation and then call `runTransition`. They never touch status columns.

**No-bypass guard (test, not convention).** `tests/order-lifecycle-guard.test.ts` scans `src/**/*.ts` outside `modules/orders/lifecycle/` and fails on any of:
- `updateTable('orders')` whose `.set(…)` contains `order_status`;
- raw `UPDATE orders`;
- `insertInto('order_status_history')`;
- `insertInto('orders')` anywhere except `createOrderAtomic`, which must take its status from `lifecycle.INITIAL_ORDER_STATUS`.

The same test asserts that every route which can change status (§O.4) is wired to an action in the catalogue. A database trigger would be stronger, but it is a migration; not done unless you ask.

### O.2 Transition catalogue

The order states are the existing 8. The delivery states are the existing 7. "Locked" means `SELECT … FOR UPDATE` inside the action's transaction. Error codes marked *frozen* are existing public contracts (Rider app, Inventory app, Customer app) and are preserved exactly, including which error wins when several apply. Every code listed below is produced only after the locks are taken.

**Customer-visible behaviour:**
- The customer sees `order_status`, `cancellation_reason`, and `history[]` as `{old_status, new_status, created_at}` only (D11).
- History notes are staff-only.
- "Notifications" means the SMS outbox row (idempotent key).

| # | Action (route) | From → To (order) | Delivery effect | Roles | Required conditions (checked in this order) | Side effects | Locks | Errors | Customer sees |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `PLACE_ORDER` (`POST /orders`) | ∅ → PLACED | — | CUSTOMER | existing checkout rules (radius, items, idempotency) | order, items (PENDING), payment PENDING; `scheduled_for` | none (insert) | existing | history "PLACED"; SMS `ORDER_PLACED` |
| 1 | `CUSTOMER_CANCEL` (`POST /orders/:id/cancel`) | PLACED, PACKED → CANCELLED | none (an ASSIGNED delivery stays; the Rider app shows "Cancelled — don't pick up") | CUSTOMER (owner) | ① order exists and is owned by the caller, else **404 ORDER_NOT_FOUND** ② OUT_FOR_DELIVERY/DELIVERED → **400 ORDER_ALREADY_OUT_FOR_DELIVERY** ③ CANCELLED → **400 ORDER_ALREADY_CANCELLED** ④ any other status → **400 ORDER_CANNOT_BE_CANCELLED** *(all frozen, D2)* | `cancellation_reason` (the customer's text or "Cancelled by customer"), `cancelled_by_user_id`, `cancelled_at` | order | as listed | CANCELLED + reason; SMS `ORDER_CANCELLED` |
| 2 | `RESOLVE_ITEM` (`POST …/resolve-item`, `PATCH …/items/:itemId`) | PLACED → ITEM_UNAVAILABLE; ITEM_UNAVAILABLE → (unchanged) | — | ADMIN, PACKING_STAFF | ① item exists on this order, else **404 ORDER_ITEM_NOT_FOUND** ② order ∈ {PLACED, ITEM_UNAVAILABLE}, else **400 ORDER_NOT_IN_SOURCING_STATE** (D9 narrows the allowed set; code frozen) ③ item SOURCED/PACKED → **409 ITEM_ALREADY_SOURCED** ④ item UNAVAILABLE/SUBSTITUTED → **409 ITEM_ALREADY_RESOLVED** | item → UNAVAILABLE or SUBSTITUTED; subtotal/total recomputed over non-UNAVAILABLE items; `payments.amount` updated; status change (history) only when leaving PLACED | item → order → payment | as listed | ITEM_UNAVAILABLE + new total; SMS `ITEM_UNAVAILABLE` (per item) |
| 3 | `PACK` (`PATCH /admin/orders/:id/status {PACKED}` from PLACED/ITEM_UNAVAILABLE) | PLACED, ITEM_UNAVAILABLE → PACKED | — | ADMIN, PACKING_STAFF | ① order exists, else **404 ORDER_NOT_FOUND** ② state, else **422 INVALID_STATUS_TRANSITION** ③ D7: no PENDING item, every SUBSTITUTED item sourced, ≥1 SOURCED/PACKED item, else **422 ORDER_NOT_PACKABLE** `{pending, unsourced_substitutions, packable_items}` | items SOURCED → PACKED (D8); `packed_at` | all items (by id) → order | as listed | PACKED; no SMS (the PRD's notification list has none for PACKED) |
| 4 | `ASSIGN_RIDER` (`POST /admin/orders/:id/assign-rider`) | PACKED → (unchanged) | new delivery ASSIGNED | ADMIN | ① order exists (404) ② state PACKED, else **422 ORDER_NOT_READY_FOR_ASSIGNMENT** (D1; was 409) ③ rider exists, else **404 RIDER_NOT_FOUND** ④ rider active, else **409 RIDER_INACTIVE** ⑤ no active delivery, else **409 ORDER_ALREADY_ASSIGNED** (also on unique violation 23505) | delivery row inserted | order (then insert) | as listed | no status change; SMS `RIDER_ASSIGNED` (key scoped to the delivery, so a replacement rider after re-stage is notified too) |
| 5 | `HAND_TO_RIDER` (`PATCH …/status {OUT_FOR_DELIVERY}`) (D3) | PACKED → OUT_FOR_DELIVERY | the single active delivery ASSIGNED/ACCEPTED → PICKED_UP (`picked_up_at`) | ADMIN, PACKING_STAFF | ① order exists (404) ② state, else **422 INVALID_STATUS_TRANSITION** ③ exactly one active delivery in ASSIGNED/ACCEPTED, else **422 NO_ACTIVE_DELIVERY** | `dispatched_at` | active deliveries (by id) → order; delivery set re-verified, else **409 ORDER_CHANGED** | as listed | OUT_FOR_DELIVERY; SMS `OUT_FOR_DELIVERY` (key scoped to the delivery; one per dispatch) |
| 6 | `RIDER_PICKUP` (`PATCH /riders/deliveries/:id/status {PICKED_UP}`) | PACKED → OUT_FOR_DELIVERY | ASSIGNED/ACCEPTED → PICKED_UP | RIDER (owner) | ① delivery is the caller's, else **404 DELIVERY_NOT_FOUND** ② order closed (CANCELLED, DELIVERED, FAILED, CUSTOMER_UNAVAILABLE) → **409 ORDER_NOT_ACTIVE** ③ delivery ∉ {ASSIGNED, ACCEPTED} → **409 INVALID_DELIVERY_TRANSITION** `{current_status, requested_status}` ④ order ≠ PACKED → **409 ORDER_NOT_READY_FOR_PICKUP** *(all frozen)* | `dispatched_at`, `picked_up_at` | delivery → order | as listed | same as #5 |
| 7 | `RIDER_ARRIVE` (`…/status {ARRIVED_AT_CUSTOMER}`) | OUT_FOR_DELIVERY → (unchanged) | PICKED_UP → ARRIVED_AT_CUSTOMER | RIDER (owner) | ① 404 as #6 ② closed → 409 ORDER_NOT_ACTIVE ③ delivery ≠ PICKED_UP → 409 INVALID_DELIVERY_TRANSITION ④ order ≠ OUT_FOR_DELIVERY → 409 INVALID_DELIVERY_TRANSITION (+`order_status`) *(frozen)* | — | delivery → order | as listed | nothing |
| 8 | `RIDER_FAIL` (`…/status {FAILED, failure_reason}`) | OUT_FOR_DELIVERY → FAILED | PICKED_UP/ARRIVED → FAILED (`failed_at`, `failure_reason`) | RIDER (owner) | reason 1–500 chars, else **400 VALIDATION_ERROR**; ①–④ as #7 with delivery ∈ {PICKED_UP, ARRIVED} *(frozen)* | — | delivery → order | as listed | FAILED; history note fixed "Delivery failed" (the rider's words stay on the delivery row); no SMS |
| 9 | `RIDER_COLLECT_COD` (`POST /riders/deliveries/:id/collect-cod`) | OUT_FOR_DELIVERY → DELIVERED | ARRIVED → DELIVERED | RIDER (owner) | ① 404 ② payment PAID or delivery DELIVERED → **409 COD_ALREADY_COLLECTED** ③ closed → 409 ORDER_NOT_ACTIVE ④ delivery ≠ ARRIVED or order ≠ OUT_FOR_DELIVERY → 409 INVALID_DELIVERY_TRANSITION ⑤ not COD → **409 NOT_COD_ORDER** ⑥ amount ≠ locked total → **400 INVALID_COD_AMOUNT** *(frozen)* | `settleCod` (amount = rider's amount = total) | delivery → order → payment | as listed | DELIVERED, PAID; SMS `DELIVERED` + `COD_PAYMENT_CONFIRMED` |
| 10 | `ADMIN_MARK_DELIVERED` (`PATCH …/status {DELIVERED, notes}`) (D4) | OUT_FOR_DELIVERY → DELIVERED | active PICKED_UP/ARRIVED → DELIVERED | ADMIN | notes required (400) ① 404 ② state, else 422 INVALID_STATUS_TRANSITION ③ an active delivery in PICKED_UP/ARRIVED, else 422 NO_ACTIVE_DELIVERY ④ payment PAID → 409 COD_ALREADY_COLLECTED ⑤ not COD → 422 NOT_COD_ORDER | `settleCod` (amount = locked total, note) | active deliveries → order → payment (+ set re-verified: 409 ORDER_CHANGED) | as listed | same as #9 |
| 11 | `ADMIN_MARK_FAILED` (`{FAILED, notes}`) (D5) | OUT_FOR_DELIVERY → FAILED | active PICKED_UP/ARRIVED → FAILED (`failure_reason` = notes) | ADMIN | notes required ① 404 ② 422 INVALID_STATUS_TRANSITION ③ 422 NO_ACTIVE_DELIVERY | — | active deliveries → order (409 ORDER_CHANGED) | as listed | FAILED; no SMS |
| 12 | `ADMIN_MARK_CUSTOMER_UNAVAILABLE` (`{CUSTOMER_UNAVAILABLE, notes}`) (D5) | OUT_FOR_DELIVERY → CUSTOMER_UNAVAILABLE | same as #11 | ADMIN | same as #11 | — | same as #11 | as listed | CUSTOMER_UNAVAILABLE; no SMS |
| 13 | `ADMIN_CANCEL` (`{CANCELLED, notes}`) (D10) | PLACED, ITEM_UNAVAILABLE, PACKED → CANCELLED | none (as #1) | ADMIN | notes required (becomes the customer-visible `cancellation_reason`) ① 404 ② 422 INVALID_STATUS_TRANSITION | `cancellation_reason` = notes, `cancelled_by_user_id`, `cancelled_at` | order | as listed | CANCELLED + reason; SMS `ORDER_CANCELLED` |
| 14 | `RESTAGE` (`{PACKED, notes}` from FAILED/CUSTOMER_UNAVAILABLE) (D6 B) | FAILED, CUSTOMER_UNAVAILABLE → PACKED | none; the failed delivery must already be closed | ADMIN | notes required ① 404 ② 422 INVALID_STATUS_TRANSITION ③ no active delivery, else **422 ACTIVE_DELIVERY_EXISTS** | items stay PACKED; `packed_at` unchanged | active deliveries → order (409 ORDER_CHANGED) | as listed | PACKED again (then the normal #4 → #6/#5 → #9); no SMS until the new rider is assigned (#4) |

**Everything else is refused.**
- Admin status endpoint: any other target, any other current state, or a same-state repeat → **422 INVALID_STATUS_TRANSITION** `{current_status, requested_status}`. This includes → PLACED, → ITEM_UNAVAILABLE, DELIVERED/CANCELLED → anything, and PLACED → OUT_FOR_DELIVERY.
- A role not in the action's `roles` → **403 TRANSITION_NOT_PERMITTED_FOR_ROLE**. That check comes after 404, and after 422 only when the transition is invalid for everyone.
- Rider ACCEPTED/REJECTED/DELIVERED/ASSIGNED → 400 (frozen).

**Item-level work that isn't a status change:** `SOURCE_ITEM` (Inventory). It uses the catalogue's `ITEM_WORK_STATES = ['PLACED','ITEM_UNAVAILABLE']` (D9, frozen 400 code) and the same item → order lock order. It stays in the Inventory module, because it also moves stock.

### O.3 Lock order (deadlock freedom)

1. **Children before the order.** Exactly one of {one item, all of the order's items by id, the rider's delivery, the order's active deliveries by id}, then the **order**, then **inventory rows by ascending id** (sourcing: one; cancellation: those the order took), then the **payment**. No action locks both inventory and payment rows.
   *Stock effect (added by the inventory stock-integrity plan, 2026-09-19):* the catalogue's `stock` field is `RESTORE_ORDER_STOCK` for CUSTOMER_CANCEL and ADMIN_CANCEL - the order's tracked stock goes back in the same transaction - and `NONE` for the other 12 actions.
2. **No action locks both items and deliveries.**
3. **The activeDeliveries set is re-read after the order lock.** If it changed, the action returns 409 ORDER_CHANGED instead of locking a delivery after the order.
4. **Assignment inserts a new delivery.** It never locks existing delivery rows.

Every writer ends at the order row and takes children first, so no wait cycle is possible. Tests assert that no concurrent pair produces `40P01`.

### O.4 Route → action map (the only status-changing routes)

| Route | Action(s) |
|---|---|
| `POST /orders` | PLACE_ORDER |
| `POST /orders/:id/cancel` | CUSTOMER_CANCEL |
| `POST /admin/orders/:id/resolve-item`, `PATCH /admin/orders/:id/items/:itemId` | RESOLVE_ITEM |
| `PATCH /admin/orders/:id/status` | `{PACKED}` → RESTAGE when the current state is FAILED/CUSTOMER_UNAVAILABLE, else PACK; `{OUT_FOR_DELIVERY}` → HAND_TO_RIDER; `{DELIVERED}` → ADMIN_MARK_DELIVERED; `{FAILED}` → ADMIN_MARK_FAILED; `{CUSTOMER_UNAVAILABLE}` → ADMIN_MARK_CUSTOMER_UNAVAILABLE; `{CANCELLED}` → ADMIN_CANCEL; `{PLACED \| ITEM_UNAVAILABLE}` → 422. The mapping picks the action from an unlocked read; the action re-checks under the lock, so a change in between is a deterministic 422/409, never a bypass. |
| `POST /admin/orders/:id/assign-rider` | ASSIGN_RIDER |
| `PATCH /riders/deliveries/:id/status` | RIDER_PICKUP / RIDER_ARRIVE / RIDER_FAIL |
| `POST /riders/deliveries/:id/collect-cod` | RIDER_COLLECT_COD |

### O.5 Tests against the catalogue

| Test file | What it covers |
|---|---|
| `tests/order-lifecycle-catalogue.test.ts` (unit, no DB) | The catalogue is complete: every action has from/to/roles/lock/errors. For every action and every order state not in `from`, `check` rejects with the action's documented code. The admin-status mapping for all 8 targets × 8 current states gives the expected action or 422. `packingBlockers` cases. |
| `tests/order-lifecycle-guard.test.ts` (static) | The no-bypass rules in §O.1. |
| `tests/order-lifecycle.test.ts` (integration, real DB) | One `describe` per catalogue row #1–#14, each covering the happy path; every listed error in order of precedence, with the DB unchanged after each; roles; side effects; history row (old/new/changed_by); the customer view (status, reason, no notes); and notifications (exact count, idempotent). Plus races, 5 repetitions each, with no `40P01` and a consistent end state: pack∥pack, pack∥customer cancel, pack∥source last item, pack∥resolve, assign∥assign, assign∥customer cancel, assign∥admin cancel, customer cancel∥rider pickup, admin cancel∥rider pickup, hand-to-rider∥rider pickup, admin FAILED∥rider collect, admin DELIVERED∥rider collect (exactly one settlement), restage∥assign. |
| Existing suites | Characterization tests that must stay green unchanged, apart from the approved code changes: rider-delivery (38), order-resolution (13), orders, inventory, inventory-app-contracts, security, notifications. The approved changes are assign 409 → 422 (D1); resolve on non-sourceable states (D9); and the orders.test staff-pack fixture, which must now source first. |

---

## N. Implementation tasks (reordered: the canonical mechanism first)

The file map is as before, plus `backend/api/src/modules/orders/lifecycle/{catalogue,engine,status-writer,settlement}.ts` and `lifecycle/actions/{customer,store,rider,admin}.ts`.

### Task 1: Lifecycle catalogue + engine + no-bypass guard (no behaviour change)
- [ ] RED: `order-lifecycle-catalogue.test.ts` (catalogue shape, admin-status mapping, `packingBlockers`) and `order-lifecycle-guard.test.ts`. The guard fails today and lists the current bypasses: order.repository cancel/update/resolve, rider.repository ×3, and the history inserts.
- [ ] Implement `catalogue.ts`, `status-writer.ts`, `engine.ts` (lock planner, ownership, check → apply pipeline), and `settlement.ts`.
- [ ] Catalogue tests GREEN. The guard stays RED until Task 2 finishes.

### Task 2: Route every existing status path through the engine (behaviour preserved) + request hygiene + D9
- [ ] Move into the engine: CUSTOMER_CANCEL, RESOLVE_ITEM (D9 narrowing plus the missing PLACED → ITEM_UNAVAILABLE history row), ASSIGN_RIDER (D1 422; delivery-scoped notification key), RIDER_PICKUP / ARRIVE / FAIL, and RIDER_COLLECT_COD (using `settleCod`). Also move PLACE_ORDER's initial status and history into `recordOrderPlaced`, and route sourcing's eligibility through `ITEM_WORK_STATES`.
- [ ] uuid validation on `/admin/orders/:id` detail, status and assign (400 instead of 500).
- [ ] RED first for the new behaviour: resolve-item on PACKED/OUT_FOR_DELIVERY/FAILED → 400 with totals unchanged; PLACED → ITEM_UNAVAILABLE writes one history row; malformed ids → 400; assign on PLACED → 422.
- [ ] GREEN: the guard test now passes; the full suite, including rider-delivery 38/38 and order-resolution 13/13, is green.

### Task 3: Admin status actions PACK and ADMIN_CANCEL (#3, #13) + endpoint mapping
- [ ] RED in `order-lifecycle.test.ts` for rows #3 and #13, including every error, the role checks, and the pack∥cancel, pack∥source and pack∥resolve races. Also a table test of the admin endpoint mapping (invalid combinations → 422).
- [ ] Implement `actions/store.ts` PACK and `actions/admin.ts` ADMIN_CANCEL; replace `updateOrderStatus` with a call to `runTransition`.
- [ ] GREEN; fix the orders.test staff-pack fixture (source first); full suite.

### Task 4: Delivery-affecting admin actions (#5, #10, #11, #12) on the shared settlement
- [ ] RED for rows #5, #10, #11 and #12, including the races hand-to-rider∥rider pickup, admin DELIVERED∥rider collect and admin FAILED∥rider collect. After hand-to-rider, the rider's next valid step is ARRIVED (200) and a pickup gets 409.
- [ ] Implement them with `activeDeliveries` locking and `settleCod`; GREEN; full suite.

### Task 5: RESTAGE (#14, D6 B)
- [ ] RED:
  - FAILED/CUSTOMER_UNAVAILABLE → PACKED (admin, notes);
  - staff → 403;
  - no notes → 400;
  - an active delivery still present → 422 ACTIVE_DELIVERY_EXISTS;
  - the full recovery path: rider fail → restage → assign rider B (SMS `RIDER_ASSIGNED` for the new delivery) → rider B pickup (a new OUT_FOR_DELIVERY SMS) → collect;
  - the customer's history shows FAILED → PACKED → OUT_FOR_DELIVERY → DELIVERED;
  - race restage∥assign.
- [ ] Implement; GREEN; full suite.

### Task 6: Read APIs: `GET /admin/riders` (D13), admin list and detail additions
As in the earlier plan (status comma list, `items_summary`, `active_delivery.rider_name`, `delivery.rider_name`). RED → GREEN; Inventory tests stay green.

### Task 7: Customer contract (list items; D11 history)
As before.

### Task 8: Customer app fixes (row tap, D14 status line)
As before.

### Task 9: Admin app access for PACKING_STAFF, role-scoped nav
As before.

### Task 10: Admin Orders board + panel + actions
As before. The UI's allowed actions per role and state are derived from a copy of the catalogue's `from`/`roles` (display only), and it includes RESTAGE ("Return to packed for a new rider").

### Task 11: Full verification
### Task 12: Live E2E (happy path, failure + recovery path, negative checks, baseline restored)
### Task 13: Generic-AI-design audit + visual refinement
### Task 14: Documentation


### Detailed steps from the first draft (still valid where Tasks 6–14 say "as before")

#### First-draft task details

File map:
- **Backend:**
  - Create `backend/api/src/modules/orders/order.transitions.ts` (pure table and checks).
  - Modify `order.repository.ts` (`updateOrderStatus` → guarded paths; `findAdminOrders`/`findCustomerOrders` additions), `order.service.ts`, `order.controller.ts`, `order.schema.ts`, `inventory.repository.ts` (eligibility), `modules/admin/index.ts` (`GET /admin/riders`), and `modules/riders/rider.repository.ts` (**read-only query** `listActiveRidersForAssignment`; no Rider behaviour change).
  - Tests: create `tests/order-operations.test.ts`; update fixtures in `orders.test.ts`, `order-resolution.test.ts`, `inventory*.test.ts` and `rider-delivery.test.ts` wherever they pack or cancel through paths that become stricter.
- **Admin:**
  - Create `src/pages/Orders.tsx`, `src/pages/OrderPanel.tsx`, `src/components/AssignRiderDialog.tsx`, `src/components/TransitionDialog.tsx`, `src/lib/orders.ts` (lanes, labels, allowed actions per role), `src/test/orders.test.tsx`.
  - Modify `src/api/{resources,types}.ts`, `src/auth/AuthContext.tsx` (ADMIN + PACKING_STAFF), `src/App.tsx`, `src/components/Layout.tsx` (role-scoped nav), `src/styles.css`, `src/test/admin.test.tsx` (scope test).
- **Customer (Flutter):** `lib/Screens/user_orders_screen.dart` (row InkWell); D14: `lib/UI/Widgets/Atoms/card_order_details.dart`; tests `test/order_model_test.dart` (list payload with items) and a new `test/orders_screen_test.dart` (row tap pushes `/order`).
- **Docs:** `docs/05-implementation/blynk-dispatch-operations-report.md`, `implementation-status.md`.

##### Draft (→ new Task 2) request hygiene
- [ ] Tests (RED): `GET /admin/orders/not-a-uuid`, `PATCH /admin/orders/not-a-uuid/status`, `POST /admin/orders/not-a-uuid/assign-rider` → 400 `VALIDATION_ERROR` (today 500). Unknown uuid → 404 `ORDER_NOT_FOUND`.
- [ ] Implement: `const { id } = orderItemParamsSchema.parse(req.params)` in `getAdminOrderById`, `updateOrderStatusAdmin` and `assignRiderAdmin` (the schema already exists from Phase 1.5).
- [ ] GREEN, then `orders.test.ts` and `security.test.ts`.

##### Draft (→ new Tasks 1 & 3) transition table, PACK, CANCEL
**Interfaces (produced):**
```ts
// order.transitions.ts
export type AdminTarget = 'PACKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CUSTOMER_UNAVAILABLE' | 'CANCELLED';
export interface TransitionRule { from: OrderStatus[]; roles: UserRole[]; notesRequired: boolean; touchesDelivery: boolean; touchesItems: boolean }
export const ADMIN_TRANSITIONS: Record<AdminTarget, TransitionRule>;
/** Throws the documented AppError for a transition that cannot happen from `current`, or that `role` may not perform. */
export function assertAdminTransition(current: OrderStatus, target: OrderStatus, role: UserRole, notes?: string): asserts target is AdminTarget;
/** D7. Returns null when packable, else the counts for ORDER_NOT_PACKABLE. */
export function packingBlockers(items: { item_status: ItemFulfillmentStatus; actual_unit_cost: unknown }[]): null | { pending: number; unsourced_substitutions: number; packable_items: number };
```
```ts
export const ADMIN_TRANSITIONS: Record<AdminTarget, TransitionRule> = {
  PACKED: { from: ['PLACED', 'ITEM_UNAVAILABLE'], roles: ['ADMIN', 'PACKING_STAFF'], notesRequired: false, touchesDelivery: false, touchesItems: true },
  OUT_FOR_DELIVERY: { from: ['PACKED'], roles: ['ADMIN', 'PACKING_STAFF'], notesRequired: false, touchesDelivery: true, touchesItems: false }, // D3(a)
  DELIVERED: { from: ['OUT_FOR_DELIVERY'], roles: ['ADMIN'], notesRequired: true, touchesDelivery: true, touchesItems: false },
  FAILED: { from: ['OUT_FOR_DELIVERY'], roles: ['ADMIN'], notesRequired: true, touchesDelivery: true, touchesItems: false },
  CUSTOMER_UNAVAILABLE: { from: ['OUT_FOR_DELIVERY'], roles: ['ADMIN'], notesRequired: true, touchesDelivery: true, touchesItems: false },
  CANCELLED: { from: ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'], roles: ['ADMIN'], notesRequired: true, touchesDelivery: false, touchesItems: false },
};
// Order of checks: target not in table or current not in `from` → 422 INVALID_STATUS_TRANSITION;
// role not in `roles` → 403 TRANSITION_NOT_PERMITTED_FOR_ROLE; notesRequired && !notes → 400 VALIDATION_ERROR (field notes).
```
- [ ] **Step 1 (RED), unit:** `tests/order-transitions.test.ts` — a table-driven test of all 8×8 (current, target) pairs × {ADMIN, PACKING_STAFF}. Allowed pairs pass; every other pair throws 422 `INVALID_STATUS_TRANSITION`; staff on admin-only targets → 403. `packingBlockers` cases: PENDING → blocked; SUBSTITUTED with a null cost → blocked; all UNAVAILABLE → blocked (`packable_items: 0`); SOURCED + UNAVAILABLE → null.
- [ ] **Step 2 (RED), integration** in `tests/order-operations.test.ts`, using the rider-delivery fixture style (the seeded customer's own fixture address, milk and butter orders, `createdOrders` cleanup in `afterAll`):
  - pack with a PENDING item → 422 `ORDER_NOT_PACKABLE {pending:1}`, DB unchanged;
  - source all items then pack → 200, order PACKED, `packed_at` set, items PACKED, one history row;
  - pack again → 422 `INVALID_STATUS_TRANSITION`;
  - staff CANCELLED → 403;
  - admin CANCELLED without notes → 400;
  - admin CANCELLED with notes → `cancellation_reason` = notes, `cancelled_by_user_id` = admin, `cancelled_at` set, one ORDER_CANCELLED notification;
  - CANCELLED → PACKED → 422;
  - DELIVERED → PLACED → 422;
  - `{status:'ITEM_UNAVAILABLE'}` → 422;
  - `{status:'PLACED'}` → 422.
- [ ] **Step 3:** implement `order.transitions.ts`, then rewrite `orderRepository.updateOrderStatus(orderId, target, user: {id, role}, notes)`:
  1. If `touchesItems`, lock `order_items WHERE order_id ORDER BY id FOR UPDATE`.
  2. Lock the order.
  3. Call `assertAdminTransition(order.order_status, target, role, notes)` against the locked row.
  4. Run the per-target branch.

  The PACKED branch: `packingBlockers(items)` → 422, else `UPDATE order_items SET item_status='PACKED' WHERE order_id=$1 AND item_status='SOURCED'`, then `packed_at`, then history. The CANCELLED branch: the cancellation fields plus the same notification insert as `cancelOrder` (key `order_${id}_CANCELLED_SMS`). The controller passes `req.user!.role`.
- [ ] **Step 4:** GREEN. Update fixtures that relied on the old permissiveness. `orders.test.ts` "allows store staff to transition order to PACKED" now needs the order's items sourced first (source them via the admin source endpoint in the test). Then the full backend suite.

##### Draft (→ new Task 4) delivery-affecting admin actions
- [ ] **RED:**
  - dispatch with no delivery → 422 `NO_ACTIVE_DELIVERY`;
  - dispatch with an ASSIGNED delivery → order OUT_FOR_DELIVERY, delivery PICKED_UP, one OUT_FOR_DELIVERY SMS (key shared with the rider path). A following rider `PICKED_UP` → 409 (existing rider rule), then rider `ARRIVED_AT_CUSTOMER` → 200;
  - staff DELIVERED → 403;
  - admin DELIVERED on OUT_FOR_DELIVERY → settlement identical to collect-cod (delivery DELIVERED with the locked total, payment PAID, order DELIVERED/PAID, one DELIVERED history row, DELIVERED + COD_PAYMENT_CONFIRMED);
  - admin DELIVERED again → 422;
  - admin FAILED with notes → delivery FAILED with `failure_reason` = notes, order FAILED, and the uq index no longer sees an active delivery;
  - CUSTOMER_UNAVAILABLE likewise.
- [ ] **RED, races (5 repetitions each):**
  - admin DELIVERED ∥ rider collect-cod → one 200, one 409/422, one settlement, no `40P01`;
  - admin FAILED ∥ rider collect-cod → consistent (either DELIVERED+PAID or FAILED+PENDING);
  - admin dispatch ∥ rider pickup → one winner.
- [ ] **Implement:**
  1. If `touchesDelivery`, `SELECT id FROM deliveries WHERE order_id=$1 AND assignment_status NOT IN ('FAILED','REJECTED') ORDER BY id FOR UPDATE`.
  2. Lock the order.
  3. Re-read the active deliveries without locks. If the id set differs from the locked set → 409 `ORDER_CHANGED`.
  4. Branch per target.
  5. Settlement: extract the body of `riderRepository.collectCod` after its checks into a shared `settleCod(trx, delivery, order, amount, userId, note)` in `orders/order.settlement.ts`. Both the rider (unchanged behaviour, same tests) and the admin path call it. That is a refactor of rider code with zero behaviour change, proven by the existing 38 rider-delivery tests staying green.
- [ ] GREEN + full suite.

##### Draft (→ new Task 2) D9 eligibility
- [ ] RED:
  - resolve-item on PACKED, OUT_FOR_DELIVERY and FAILED orders → 400 `ORDER_NOT_IN_SOURCING_STATE`, with total, payment and status unchanged;
  - source on a PACKED order (with a PENDING item inserted directly) → 400;
  - PLACED and ITEM_UNAVAILABLE still work (existing tests).
- [ ] Implement: an `order_status NOT IN ('PLACED','ITEM_UNAVAILABLE')` → same error in both repositories.
- [ ] GREEN, plus the Inventory app tests (its message mapping is unchanged).

##### Draft (→ new Tasks 2 & 6) assign code, riders, admin reads
- [ ] RED:
  - assign on PLACED → **422** `ORDER_NOT_READY_FOR_ASSIGNMENT` (update `rider-delivery.test.ts` and the live-E2E expectation);
  - `GET /admin/riders` as ADMIN → the active riders only, with `open_deliveries` counted from real rows (an inactive fixture rider is excluded); staff/customer/rider → 403;
  - `GET /admin/orders?status=PLACED,PACKED` → both statuses, each with `items_summary` and `active_delivery.rider_name`; an unknown status in the list → 400;
  - `GET /admin/orders/:id` → `delivery.rider_name`.
- [ ] Implement:
  - `findAdminOrders`: `where('order_status','in', statuses)`. Then one grouped query for `items_summary` (`count(*) filter (where item_status = …)`) and one joined query for active deliveries plus rider names, merged in memory.
  - `GET /admin/riders`: `requireRoles('ADMIN')` in `admin/index.ts`, backed by a read-only rider repository query.
- [ ] GREEN + full suite + Inventory tests.

##### Draft (→ new Task 5) RESTAGE
- [ ] RED:
  - admin `{status:'PACKED', notes}` on a FAILED order whose delivery is FAILED → 200, order PACKED, history `FAILED→PACKED`; items stay PACKED;
  - then assign rider B → 200 → rider B pickup → OUT_FOR_DELIVERY;
  - staff → 403; no notes → 400;
  - FAILED order with a still-active delivery (inserted directly) → 409 `ORDER_CHANGED`/422;
  - CUSTOMER_UNAVAILABLE → PACKED works likewise;
  - the customer sees FAILED → PACKED → OUT_FOR_DELIVERY.
- [ ] Implement: add `FAILED`, `CUSTOMER_UNAVAILABLE` to `PACKED.from`, with a per-edge rule (ADMIN only, notes, `touchesDelivery` to lock and verify that no active delivery exists). The PACKED branch skips `packingBlockers` for this edge; the items are already PACKED.

##### Draft (→ new Task 7) customer contract
- [ ] RED:
  - `GET /orders` → each order has `items` with name/quantity/price and **no** `estimated_unit_cost`/`actual_unit_cost`/`markup_percentage_applied`;
  - an order with 2 lines → 2 items;
  - `GET /orders/:id` `history[]` keys = `id, order_id, old_status, new_status, created_at` (no `reason_or_notes`, no `changed_by_user_id`);
  - another customer's order → 404 (existing).
- [ ] Implement: batch-load items for the page's order ids in `findCustomerOrders`; `sanitizeCustomerOrder` maps the history.
- [ ] GREEN + full suite.

##### Draft (→ new Task 8) Flutter
- [ ] RED (widget test `test/orders_screen_test.dart`): pump `OrdersScreen` with an `OrderProvider` pre-filled from a list payload that includes items (a new `OrderProvider.debugSetOrders` test seam, if the provider has none, marked `@visibleForTesting`), then:
  - the row shows "2 items · Rs.1,345";
  - tapping the **order number text** (not the arrow) pushes `/order` with the order id (a recording `onGenerateRoute`).
- [ ] RED (`order_model_test.dart`): a list-shaped payload with `items` → `items.length` and the quantity sum.
- [ ] Implement: `InkWell(onTap: …)` around the row content in `user_orders_screen.dart`, with the same navigation call as the arrow. D14: one `Text(statusLabel)` row in `card_order_details.dart`, reusing the list's label and colour helpers (moved to `order_model.dart` as an extension so both screens share them; no restyle).
- [ ] GREEN: `flutter test`, `flutter analyze` (no new issues).

##### Draft (→ new Task 9) Admin access
- [ ] RED (`admin.test.tsx`):
  - a PACKING_STAFF sign-in lands on `/orders`; nav = [Orders] only; visiting `/products` redirects to `/orders`;
  - ADMIN nav = Dashboard, Orders, Products, Categories, Promotions;
  - CUSTOMER and RIDER are still refused with the existing message;
  - the scope test now asserts no inventory/stock/supplier/rider-app text (Orders is allowed).
- [ ] Implement: `OPERATIONS_ROLES = ['ADMIN','PACKING_STAFF']` in the AuthContext checks; `RequireRole` for the ADMIN-only routes; nav items carry `roles`.

##### Draft (→ new Task 10) Orders board
- [ ] RED (`orders.test.tsx`, mock API in the style of the existing admin helpers):
  - **Lanes:** real `GET /admin/orders?status=…` data is sorted into lanes; the empty state is "No live orders" (no invented rows).
  - **Pack gating:** the Pack button shows only when `items_summary` says packable; otherwise "2 of 3 sourced — source in Inventory". Pack sends `PATCH …/status {status:'PACKED'}` once (double-click guard).
  - **Conflicts:** a 422 `ORDER_NOT_PACKABLE` re-reads the order and shows "Something changed: 1 item still to source".
  - **Assign:** Assign opens the rider picker from `GET /admin/riders` (active only) and sends `{rider_id}`. 409 `ORDER_ALREADY_ASSIGNED` → re-read + message; 422 → message.
  - **Staff limits:** staff never sees Assign / Cancel / Mark delivered / Mark failed.
  - **Confirmations:** Cancel requires a reason labelled "Shown to the customer" and a confirm. Mark delivered (admin) restates "Records Rs. 610 cash as collected and completes the delivery" and requires a note. Mark failed / customer unavailable require notes.
  - **Scheduled:** "Scheduled 8:00" is shown when `scheduled_for` is set.
  - **Panel content:** the order panel shows items read-only with statuses, the customer phone as a `tel:` link, and history. **No** cost or supplier fields rendered.
  - **Freshness:** re-read on visibility and every 20s (fake timers).
  - Option B only: a FAILED order shows "Return to packed for a new rider" (admin, with note).
- [ ] Implement per §L. GREEN; `tsc`; `vite build`; the production bundle has no dev skip (existing check).

##### Draft (→ new Task 11) verification
- [ ] Backend `tsc`, full suite, `npm run build`; the row-count baseline before and after is identical (clean up the known `notifications.test.ts` leak rows with the guarded script if they reappear, and report it).
- [ ] Admin, Inventory and Rider: `tsc`, `vitest`, `vite build`. Flutter: `flutter test`, `flutter analyze`.

##### Draft (→ new Task 12) live E2E
`scratchpad/e2e/dispatch_live.cjs` (Edge; Admin at 1366×900; Rider on Pixel 7):
1. The customer places a 2-item COD order (API, real OTP).
2. Admin UI (as staff): the order sits in **To pack** at `0 of 2 sourced`; Pack is not offered. DB: PLACED.
3. Inventory API (staff): source both items → Admin board shows `2 of 2`; staff clicks **Pack** → DB: PACKED, items PACKED, one history row.
4. Admin UI (as admin): **Assign rider** → the picker lists only active riders → choose Farhan → DB: delivery ASSIGNED; the board moves it to **Waiting for pickup**.
5. Rider UI: Picked up → Arrived → Collect Rs. X → DB after each (as in the Rider E2E).
6. Customer: API list shows `items.length = 2`; detail history has no staff notes. Flutter app (manual, screenshot): the list shows "2 items", **tapping the row** opens the detail, and the status reads Placed/Packed/Out for delivery/Delivered at each stage (captured at the 4 stages).
7. **Exception path (second order):** pack → assign → rider pickup → admin **Mark failed** (note) → DB: delivery FAILED with the note, order FAILED; the customer history has no note. Option B: admin **Return to packed** → assign again → rider completes.
8. **Negative (API, live):**
   - staff CANCELLED → 403;
   - invalid transition → 422;
   - resolve-item on PACKED → 400;
   - assign on PLACED → 422;
   - duplicate assign → 409;
   - malformed id → 400;
   - customer/rider tokens on `/admin/orders` and `/admin/riders` → 403.
9. `finally`: delete the created orders (notifications, payments, deliveries, orders) and the fixture address; assert the full baseline row counts are unchanged.

##### Draft (→ new Task 13) audit
- [ ] Audit screenshots of the board, panel and dialogs (1366, 1024 and 390 widths) for dashboard clichés, cards, weak hierarchy, colour misuse and unclear primary actions. Fix CSS/markup only; re-run the admin tests and the E2E UI steps.

##### Draft (→ new Task 14) docs
- [ ] `docs/05-implementation/blynk-dispatch-operations-report.md`: requirements, the audit table (§B), conflicts and decisions, the state machine, locking, API/DB changes, tests, E2E, design audit, limitations. `implementation-status.md` gains a section ending in the status line.

---

## Self-review

- **Spec coverage:** §1 → B, D, Tasks 1–4; §2 → E, Tasks 2, 10; §3 → F, Tasks 5, 10; §4 → G, Task 6 (gated); §5 → H, Tasks 7–8; §6 → I, J, Tasks 2–5; §7 → L, Tasks 10, 13; §8 → Tasks 11–12, 14.
- **Placeholders:** the frontend tasks list exact assertions rather than full test code, because their component names depend on D12/D14 approval; the backend guard code is given verbatim.
- **Consistency:** `ADMIN_TRANSITIONS` / `assertAdminTransition` / `packingBlockers` (Task 2) are used by Tasks 3, 6 and 10 (the UI mirrors `ADMIN_TRANSITIONS` in `src/lib/orders.ts` for display only). `settleCod` (Task 3) is shared by rider and admin.
