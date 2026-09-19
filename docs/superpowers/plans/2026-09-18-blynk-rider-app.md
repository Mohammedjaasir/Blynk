# Blynk Rider App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate, mobile-first Rider web app that lets an assigned rider pick up, deliver and settle COD for their own orders, backed by the existing Blynk API with its rider endpoints hardened so the backend (not the UI) enforces ownership, the documented state machine, COD integrity and concurrency.

**Architecture:** `apps/rider` is a React 18 + Vite 5 + TypeScript app (same stack and patterns as `apps/inventory`), port 5175, talking only to the existing Express API (`/api/v1/auth/*`, `/api/v1/riders/*`). No new backend, database, WebSockets, maps SDK or offline sync. Backend work is confined to `modules/riders`, the `assign-rider` path in `modules/orders`, and one atomicity fix in customer cancellation.

**Tech Stack:** Node/TS Express, Kysely, Postgres, zod, Vitest + supertest (backend). React 18, react-router 6, Vite 5, plain CSS, Vitest + Testing Library (frontend). playwright-core (msedge, mobile viewport) for live E2E.

**Spec:** the user's "BLYNK RIDER APP — REQUIREMENTS + IMPLEMENTATION PLAN" message (2026-09-18). Canonical sources: `docs/01-product/blynk_prd.md` §2, §3.4–3.6, §4; `docs/04-business/business-rules.md` §4, §5, §7; `docs/02-architecture/blynk_backend_api_architecture.md` §5 (rider API table), §G (transition matrix), §H (assignment), §I (COD settlement).

## Global Constraints

- Rider is a separate app. Do not add Rider to Admin, Inventory or Customer. No Rider nav in any other app.
- One backend, one database. No duplicated order data. No new delivery or order states.
- No WebSockets, Redis, Kafka, microservices, GPS/location streaming, route optimisation, ETAs, or maps SDKs.
- No fake data: no seeded or fabricated deliveries, riders, locations, amounts, ETAs, routes.
- The rider never sees supplier info, purchase or actual unit cost, markup, inventory data, internal notes, or other customers' data.
- The backend is the authority for role, ownership, state transitions, COD amount and concurrency. UI checks are UX only.
- Colours: `#FFE141` Blynk Yellow for primary action; `#0C831F` Blynk Green only for success states; never green-dominant, never coral or red as brand colour.
- Test-first for every backend change. Tests leave no orders, deliveries, riders, users, addresses or notifications behind.
- Customer cancellation rules (only before `OUT_FOR_DELIVERY`) are not changed.
- D1–D5 from the Inventory phases stay as they are.
- Commit nothing unless the user asks.

---

## A. Requirements

### A1. What the backend already does (verified in code, not assumed)

| Area | Where | What it does today |
|---|---|---|
| Rider auth | `modules/auth/auth.service.ts:165-210` | OTP verify finds the existing user by phone and issues a JWT with the DB role. A `RIDER` user gets a `RIDER` token. An unknown phone is auto-registered as `CUSTOMER` (never as rider). Inactive users → 403 `ACCOUNT_DEACTIVATED`. |
| RBAC | `middleware/role.middleware.ts` | `requireRoles` checks the role in the server-signed JWT. |
| Rider records | `riders` table; seed `f0000001-…-0001` → user `a0000001-…-0002` Farhan Mohamed, +94779876543, MOTORCYCLE WP-BCX-8842, active | One real rider exists. |
| Rider routes | `modules/riders/index.ts`, mounted at both `/api/v1/rider` and `/api/v1/riders` (`app.ts:129-130`) | `GET /deliveries`, `GET /deliveries/:id`, `PATCH /deliveries/:id/status`, `POST /deliveries/:id/collect-cod`, all `requireRoles('RIDER')`. |
| Ownership | `rider.repository.ts` | Every query filters `deliveries.rider_id = <rider of caller>`. Another rider's delivery → 404 `DELIVERY_NOT_FOUND` (no existence leak). |
| Status update | `rider.repository.ts updateDeliveryStatus` | Locks the delivery row, then sets **any** of the 7 statuses with **no transition check**. `PICKED_UP` → order `OUT_FOR_DELIVERY` + history (old_status hard-coded `PACKED`) + `OUT_FOR_DELIVERY` SMS. `FAILED` → order `FAILED` + history (old_status hard-coded `OUT_FOR_DELIVERY`). |
| COD | `rider.service.ts collectCod`, `rider.repository.ts collectCod` | Checks `amount == total_amount` (read **outside** the transaction), then in a transaction: delivery `DELIVERED` + cod amount, payment `PAID`, order `DELIVERED` + `PAID`, history, `DELIVERED` and `COD_PAYMENT_CONFIRMED` SMS. **No state check at all.** |
| Assignment | `POST /admin/orders/:id/assign-rider` (ADMIN) → `orderRepository.assignRider` | Inserts `deliveries` row `ASSIGNED` and a `RIDER_ASSIGNED` SMS. No check on order state or rider state. Duplicate active assignment is blocked by `uq_deliveries_active_assignment` but surfaces as **500** (the test asserts 500). Unknown rider → FK violation → 500. |
| Customer tracking | `GET /orders`, `GET /orders/:id` | Order detail includes `history` and the **raw** active `delivery` row (rider_id, cod_collected_amount, handover_notes, failure_reason). The Flutter app maps every order status (`order_model.dart`) and does not read `delivery`. It refreshes via pull-to-refresh. |
| Cancellation | `order.service.ts cancelOrderCustomer` | Allows cancel in `PLACED`/`PACKED`. The status is read **without a lock**, then `cancelOrder` updates unconditionally. |
| Admin status | `PATCH /admin/orders/:id/status` (ADMIN, PACKING_STAFF) | Sets any status, **no transition matrix**. |
| Rider profile / availability | Architecture lists `GET /rider/me`, `PATCH /rider/me/status`, `GET/POST /admin/riders` | **Not implemented.** |

### A2. Functional requirements (Rider foundation)

1. A rider signs in with the existing OTP flow. Only `RIDER` accounts with an active rider profile get past sign-in.
2. Home answers "what do I act on now?": the current active delivery first, then other active ones, then "Done today". A real empty state when nothing is assigned.
3. The delivery screen shows only what's needed to deliver: order number, status, recipient name, phone (tap to call), address lines, city, delivery instructions, items (name × qty, if R6 is approved), payment method and the amount to collect.
4. One obvious primary action per state: **Picked up** → **Arrived** → **Collect Rs. X & complete**. Each is confirmed server-side. Completion is deliberate: a confirm sheet restates the amount.
5. The rider can report **Can't deliver** with a reason (after pickup only).
6. Cancelled-while-assigned orders show a clear "Cancelled — don't pick up" state; no actions.
7. Network loss, timeouts and stale state are visible, retryable, and never leave the UI claiming a state the backend doesn't have.

Out of scope (documented as future): live location, maps navigation, ETAs, accept/reject, availability toggle, rider profile screen, offline queueing, proof-of-delivery photos or OTP, dispatch UI.

---

## B. Rider roles and permissions

| Action | CUSTOMER | RIDER | PACKING_STAFF | ADMIN |
|---|---|---|---|---|
| `GET/PATCH/POST /riders/*` | 403 | own deliveries only | 403 | 403 |
| Catalog, prices, promotions, media mutations | 403 | 403 (verified in `security.test.ts:179-230`) | — | ADMIN |
| Inventory, suppliers, sourcing | 403 | 403 | allowed | allowed |
| Assign rider | 403 | 403 | 403 | ADMIN |
| Admin order status | 403 | 403 (`security.test.ts:491`) | allowed | allowed |

A rider can't assign themselves (no rider route writes `rider_id`), can't pick a rider id (it's derived from the JWT user → `riders.user_id`), and can't touch other riders' deliveries (404). Admin is **not** a rider: `requireRoles('RIDER')` only; the Rider app rejects non-RIDER sessions with a clear message.

Gaps (fixed in Task 1): an inactive rider profile (`riders.is_active = false`) can still act today.

---

## C. Existing backend workflow (as traced)

```
Customer POST /orders ─► order PLACED, payment PENDING (COD), ORDER_PLACED SMS
Staff (Inventory app) sources items ─► order stays PLACED
Staff/Admin PATCH /admin/orders/:id/status {PACKED} ─► order PACKED           (no UI today; API only)
Admin POST /admin/orders/:id/assign-rider {rider_id} ─► delivery ASSIGNED, RIDER_ASSIGNED SMS   (no UI today; API only)
Rider PATCH /riders/deliveries/:id/status {PICKED_UP} ─► delivery PICKED_UP, order OUT_FOR_DELIVERY, OUT_FOR_DELIVERY SMS
Rider PATCH … {ARRIVED_AT_CUSTOMER} ─► delivery ARRIVED_AT_CUSTOMER (order unchanged)
Rider POST /riders/deliveries/:id/collect-cod {amount} ─► delivery DELIVERED, payment PAID, order DELIVERED/PAID, 2 SMS
Rider PATCH … {FAILED, failure_reason} ─► delivery FAILED, order FAILED
Customer GET /orders/:id ─► sees the new order_status and history
```

---

## D. Rider information architecture

Two levels, no tab bar:

```
/login                      OTP sign-in (+ dev-only Skip)
/                           Deliveries
  ├─ NOW        the one delivery to act on (largest card-less block, primary action inline)
  ├─ NEXT       other active assignments (ASSIGNED/PICKED_UP/ARRIVED), oldest assignment first
  └─ DONE TODAY delivered today (Asia/Colombo), collapsed; count + amounts collected
/deliveries/:id             Delivery
  ├─ header      order number (mono) + status rail  Pick up ─ On the way ─ Handover
  ├─ destination recipient, address, instructions, Call button
  ├─ bag         items × qty (R6)
  ├─ cash        "Collect Rs. 1,690" (COD, from backend)
  └─ action bar  sticky bottom, thumb zone: one yellow primary + secondary "Can't deliver"
```

Header: Blynk mark, rider first name, refresh, sign out. Nothing else.

---

## E. Delivery lifecycle (existing states only)

| Delivery (`assignment_status`) | Order (`order_status`) | Rider action | Backend rule (after Task 2) |
|---|---|---|---|
| ASSIGNED | PACKED | **Picked up** | delivery ∈ {ASSIGNED, ACCEPTED} and order = PACKED → PICKED_UP; order → OUT_FOR_DELIVERY |
| ASSIGNED | PLACED / ITEM_UNAVAILABLE | none ("Being packed") | pickup → 409 `ORDER_NOT_READY_FOR_PICKUP` |
| ASSIGNED | CANCELLED | none ("Cancelled — don't pick up") | every action → 409 `ORDER_NOT_ACTIVE` |
| PICKED_UP | OUT_FOR_DELIVERY | **Arrived** / Can't deliver | → ARRIVED_AT_CUSTOMER; FAILED needs reason |
| ARRIVED_AT_CUSTOMER | OUT_FOR_DELIVERY | **Collect Rs. X & complete** / Can't deliver | collect-cod only from here |
| DELIVERED | DELIVERED | none | any action → 409 `INVALID_DELIVERY_TRANSITION` |
| FAILED | FAILED | none (drops out of list, as today) | any action → 409 |

`ACCEPTED`/`REJECTED`: enum values exist, no documented rider flow. `DELIVERED` via `PATCH status`: removed; completion happens only through collect-cod, so delivery and order can't diverge (today `PATCH {DELIVERED}` marks the delivery delivered but leaves the order `OUT_FOR_DELIVERY` and payment `PENDING`).

---

## F. COD workflow

Per architecture §I:
1. The amount to collect is `orders.total_amount` (= `payments.amount`), shown read-only, from the backend.
2. At the door the rider taps **Collect Rs. X & complete** → confirm sheet repeats "Collect Rs. X in cash from <name>" → the app sends `{ amount: <the backend's total_amount> }`.
3. The backend, inside one transaction with delivery and order rows locked, requires delivery `ARRIVED_AT_CUSTOMER`, order `OUT_FOR_DELIVERY`, `payment_method = COD`, `payment_status = PENDING`, and `amount == orders.total_amount` (read under the lock, fixing today's check-then-act gap). Then it applies the existing settlement.
4. Already `PAID`/`DELIVERED` → 409 `COD_ALREADY_COLLECTED` (architecture §I.4).
5. The rider can never change the total: the only accepted amount is the backend's own total. A mismatch → 400 `INVALID_COD_AMOUNT` (existing).

No new payment system, no partial collection, no change handling.

---

## G. Customer ↔ Rider integration

```
Rider app ─► /api/v1/riders/* ─► Postgres (deliveries, orders, payments, history, notifications outbox)
Customer app ─► /api/v1/orders[/:id] ─► same rows ─► order_status OUT_FOR_DELIVERY / DELIVERED / FAILED
```

No new channel. The Customer app already renders these statuses (`order_model.dart`) and refreshes with pull-to-refresh. **No Customer UI change.** The only customer-facing API change proposed is R7 (trim the raw `delivery` object the customer receives).

---

## H. API mapping

| Rider requirement | Existing endpoint | Supported? | Backend change needed? |
|---|---|---|---|
| Authentication | `POST /auth/request-otp`, `/auth/verify-otp`, `/auth/refresh`, `GET /auth/me` | Yes | No |
| Rider profile | `GET /auth/me` (name, role); `riders` row via 403 `RIDER_PROFILE_NOT_FOUND` | Partly (`/rider/me` documented, not built) | No for foundation. Add `is_active` check (Task 1). |
| Assignments list | `GET /riders/deliveries` | Yes, but returns DELIVERED forever | R5: bound to active + delivered today |
| Order details | `GET /riders/deliveries/:id` | Yes, no items; malformed id → 500 | uuid 400 (Task 1); items R6 |
| Pickup | `PATCH /riders/deliveries/:id/status {PICKED_UP}` | Yes, **unguarded** | Transition + order-state guard (Task 2) |
| Out for delivery | same call (PICKED_UP → order OUT_FOR_DELIVERY) | Yes | Correct history old_status (Task 2) |
| Arrived | `PATCH … {ARRIVED_AT_CUSTOMER}` | Yes, unguarded | Guard (Task 2) |
| COD + completion | `POST /riders/deliveries/:id/collect-cod` | Yes, **unguarded** | State, payment and in-transaction amount checks, 409 on repeat (Task 3) |
| Failure | `PATCH … {FAILED, failure_reason}` | Yes, unguarded | Guard + required reason (Task 2, R4) |
| Customer unavailable | none | **No** | R3 (recommend defer) |
| Accept / reject | `PATCH … {ACCEPTED/REJECTED}` accepted today, unguarded | Undocumented flow | R2: refuse for now |
| Tracking (customer) | `GET /orders/:id` | Yes | R7: sanitize `delivery` |
| Assignment (ops) | `POST /admin/orders/:id/assign-rider` | Yes, unguarded, 500s | R8 (Task 4) |
| Availability toggle | none (`PATCH /rider/me/status` documented) | No | Future |
| Live location | none | No | Future (not in requirements) |

---

## I. Database mapping

| Table | Columns used | Supports Rider? |
|---|---|---|
| `riders` | id, user_id (unique), dark_store_id, vehicle_*, is_active, is_available | Yes |
| `deliveries` | order_id, rider_id, assignment_status, cod_collected_amount, assigned/accepted/picked_up/delivered/failed_at, failure_reason, handover_notes; partial unique `uq_deliveries_active_assignment`; `idx_deliveries_rider_active` | Yes |
| `orders` | order_number, order_status, payment_method/status, total_amount, delivery_* snapshot (recipient, phone, lines, city, postal, lat/lng, instructions), dispatched_at, delivered_at | Yes; the address is snapshotted, so the rider reads the order, not the customer's address book |
| `order_items` | product_name_snapshot, quantity, item_status (costs excluded) | Yes (R6) |
| `payments` | payment_status, paid_at, amount | Yes |
| `order_status_history`, `notifications` | existing writes | Yes |

**No migration needed.** Every state, column and constraint the plan uses already exists.

---

## J. Backend gaps (each maps to a task or a decision)

| # | Gap | Severity | Proposal |
|---|---|---|---|
| G1 | No transition validation on `PATCH /riders/deliveries/:id/status`: a rider can pick up a **cancelled** or unpacked order (a CANCELLED order becomes OUT_FOR_DELIVERY), go backwards, repeat, or mark DELIVERED without COD | Critical | Task 2 (R1) |
| G2 | collect-cod has no state checks: it can complete an order that's cancelled, still PLACED, not picked up, or already delivered; repeats rewrite history | Critical | Task 3 |
| G3 | COD amount checked outside the transaction (item resolution can change the total in between) | High | Task 3 |
| G4 | History old_status hard-coded (`PACKED` / `OUT_FOR_DELIVERY`) | Medium | Task 2 |
| G5 | Malformed delivery id → 500 | Medium | Task 1 |
| G6 | Inactive rider profile can still act | Medium | Task 1 |
| G7 | assign-rider: any order state, unknown rider → 500, duplicate → 500 | High | Task 4 (R8) |
| G8 | Customer cancel is check-then-act: it can race a pickup and cancel an order already out for delivery | High | Task 5 (R9), same rule, made atomic |
| G9 | Customer receives the raw `delivery` row, including rider-typed failure_reason and handover_notes | Medium | Task 6 (R7) |
| G10 | `GET /riders/deliveries` returns every DELIVERED assignment ever | Low | Task 6 (R5) |
| G11 | No CUSTOMER_UNAVAILABLE rider path | Product | R3 |
| G12 | No ops UI to pack and assign (API only) | Product | R12, out of this phase |
| G13 | `PATCH /admin/orders/:id/status` ignores the documented matrix (staff can set DELIVERED/OUT_FOR_DELIVERY directly) | High, outside Rider | Flag only; separate phase |
| G14 | Documented reassignment after FAILED conflicts with order → FAILED (assign requires PACKED) | Product | Flag only |

### Decisions needed (recommendation first)

- **R1 Transition enforcement.** Enforce table E in the backend. The existing `orders.test.ts` rider fixture picks up a `PLACED` order, so it gets a `PACKED` step. *Recommended.*
- **R2 ACCEPTED/REJECTED.** Rider may not set them in the foundation (400); schema narrowed to `PICKED_UP | ARRIVED_AT_CUSTOMER | FAILED`. *Recommended.* Alternative: allow ASSIGNED → REJECTED before pickup.
- **R3 Customer unavailable.** Defer; the rider uses **Can't deliver** (FAILED + reason) and the customer sees "Failed". *Recommended.* Alternative: `PATCH {FAILED, outcome:'CUSTOMER_UNAVAILABLE'}` → delivery FAILED, order CUSTOMER_UNAVAILABLE.
- **R4 Failure reason required** for FAILED (1–500 chars, trimmed). *Recommended.*
- **R5 Queue scope.** `GET /riders/deliveries` returns active assignments plus DELIVERED today (Asia/Colombo). *Recommended.*
- **R6 Items in rider detail.** Add `items: [{ id, product_name_snapshot, quantity, item_status }]`, excluding UNAVAILABLE, with no prices or costs. *Recommended.*
- **R7 Customer delivery trim.** The customer's `delivery` becomes `{ assignment_status, assigned_at, picked_up_at, delivered_at }`. The Flutter app doesn't read it (verified). *Recommended.*
- **R8 assign-rider hardening.** Order must be PACKED (architecture §H.1), rider must exist and be active → 404/409; duplicate active assignment → 409 `ORDER_ALREADY_ASSIGNED`. The existing 500 assertion in `orders.test.ts` becomes 409. *Recommended.*
- **R9 Atomic customer cancel.** Lock the order and re-check PLACED/PACKED inside the transaction. The rule is unchanged. *Recommended.*
- **R10 Stack.** React + Vite + TS at `apps/rider`, port 5175, installable manifest, no service worker. The architecture doc says "Next.js PWA"; Admin/Inventory already chose Vite. *Recommended.*
- **R11 Maps.** No "Open in Maps" in the foundation; show the address and instructions only. Future: a plain `geo:`/maps URL hand-off. *Recommended.*
- **R12 Dispatch UI.** Out of this phase; the E2E packs and assigns through the existing admin API. A later decision should place it (not Rider). *Recommended.*
- **R13 Dev skip.** D5 pattern: `VITE_DEV_RIDER_PHONE`, `import.meta.env.DEV` inline, absent from production bundles. *Recommended.*

---

## K. Security and concurrency risks

| Risk | Today | After plan | Test |
|---|---|---|---|
| IDOR: rider B reads/acts on rider A's delivery | 404 (good) | unchanged | `rider-delivery.test.ts` IDOR block |
| Arbitrary order id as delivery id | 404 / malformed → 500 | 404 / 400 | yes |
| Rider-supplied rider id | not accepted anywhere | unchanged | body `rider_id` ignored test |
| Role escalation (CUSTOMER/STAFF/ADMIN on `/riders/*`) | 403 | unchanged | yes, all three roles |
| Pick up a cancelled order | **allowed** | 409 | yes |
| Complete without pickup / arrival | **allowed** | 409 | yes |
| Double COD (retry, two taps, two devices) | **re-applies** | 200 then 409 | concurrent `Promise.all` |
| Double pickup | re-applies, duplicate history | 200 then 409 | concurrent |
| Customer cancel ∥ rider pickup | can end CANCELLED while out for delivery | exactly one wins, consistent rows | concurrent |
| Admin status change ∥ collect-cod | collect ignores order state | collect re-checks under lock | yes |
| Item resolution ∥ collect-cod (total changes) | stale amount accepted | amount checked under lock | yes |
| Lock order | rider paths lock delivery → order; admin and resolve lock order (and item → order) | unchanged ordering, so no cycle | covered by concurrency runs |
| Rider sees costs/notes | explicit column list, no costs | items exclude cost fields | response-shape assertion |

---

## L. Visual direction

**Skill note:** no "Taste" skill is installed on this machine (`~/.claude/skills` has `ui-ux-pro-max`, `design`, `ui-styling`, `brand`, `design-system`, …). As with Inventory, `ui-ux-pro-max` stands in. Its generated system (navy/blue, Russo One, landing-page hero) was **rejected**: off-brand and built for marketing pages. Its UX rules were kept: 44px+ targets, 8px+ gaps, 4.5:1+ contrast, confirm irreversible actions, visible success, safe areas, reduced motion. If you install a Taste skill, I'll rerun this section with it before implementation.

**Concept: "the dispatch slip".** The rider holds one delivery at a time, so the screen should read like the slip taped to the bag, not a dashboard of cards.

- **Surface:** warm paper white `#FBFAF5` with ink `#12151F` text, for sunlight legibility (light beats dark outdoors). There's no dark theme in the foundation; it's a field tool used in daylight 8 AM–9 PM.
- **Type:** Catamaran (Blynk's existing UI face) 800 for the destination block at 28–32px, so the address is the hero, not the order number. JetBrains Mono for order numbers and amounts (`#BLK-…`, `Rs. 1,690`), tabular numerals. Body 17px minimum, labels 13px uppercase tracking +0.08em.
- **Primary action:** a full-width yellow `#FFE141` bar with ink text, 64px tall, pinned to the bottom above the safe-area inset (`env(safe-area-inset-bottom)`), in the thumb zone. One per screen. The verb carries the state: "Picked up", "I've arrived", "Collect Rs. 1,690". The secondary "Can't deliver" is a text button above it, never yellow.
- **Status rail:** three ticks, Pick up → On the way → Handover, rendered as a thin ink line with filled/hollow nodes. The current step is labelled; done steps are ink, not green. Green appears only on the final "Delivered · Rs. 1,690 collected" confirmation and the Done today tick.
- **Cash block:** on arrival the amount becomes the largest element on screen (mono 44px) with "Cash to collect", so the number to count is unmissable.
- **No cards:** sections are separated by hairline rules and spacing, like a printed slip. The queue is a list of slips; NOW is expanded, NEXT is compressed to one line (number · area · amount).
- **Motion:** 150–200ms. After a successful action the rail node fills and the next action slides up 8px. Respect `prefers-reduced-motion`. No skeleton shimmer, no confetti.
- **Error/stale:** an ink banner with a yellow left rule ("This delivery changed. Showing the latest."), not a red toast.
- **Avoid:** map placeholders, fake ETAs, avatar bubbles, KPI tiles, bottom tab bars, gradients, icon-only buttons.

---

## M. Implementation plan

### File structure

Backend (modify):
- `backend/api/src/modules/riders/rider.schema.ts`: `deliveryParamsSchema`, narrowed `updateDeliveryStatusSchema`, FAILED reason refine
- `backend/api/src/modules/riders/rider.repository.ts`: guarded transitions, guarded collectCod, items, today filter
- `backend/api/src/modules/riders/rider.service.ts`: active-profile check, amount check moved into the repository transaction
- `backend/api/src/modules/riders/rider.controller.ts`: parse params
- `backend/api/src/modules/orders/order.repository.ts`: `assignRider` guards; `cancelOrder` lock + recheck; `findOrderById` unchanged
- `backend/api/src/modules/orders/order.service.ts`: `sanitizeCustomerOrder` trims `delivery`; `assignRiderAdmin` validation
- `backend/api/tests/orders.test.ts`: fixture gains PACKED; the 500 assertion becomes 409

Backend (create):
- `backend/api/tests/rider-delivery.test.ts`: lifecycle, IDOR, COD, concurrency, customer integration

Frontend (create) `apps/rider/`:
- `package.json`, `vite.config.ts` (5175, strictPort), `index.html` (viewport-fit=cover, theme-color, fonts), `public/manifest.webmanifest`, `public/favicon.png`, `.env.example`, `.env.development.local` (git-ignored)
- `src/api/client.ts` (tokenStore `blynk.rider.*`, single-flight refresh, 15s timeout → `TIMEOUT`, offline → `NETWORK`)
- `src/api/types.ts`, `src/api/resources.ts` (`authApi`, `deliveriesApi`)
- `src/auth/AuthContext.tsx` (RIDER-only; `RIDER_PROFILE_NOT_FOUND`/`RIDER_INACTIVE` → signed-out message)
- `src/lib/delivery.ts` (`nextAction`, `stage`, `splitQueue`), `src/lib/errors.ts`, `src/lib/format.ts`, `src/lib/useLoad.ts`, `src/lib/useOnline.ts`
- `src/components/`: `ActionBar.tsx`, `ConfirmSheet.tsx`, `FailSheet.tsx`, `StatusRail.tsx`, `Banner.tsx`, `Header.tsx`
- `src/pages/`: `Login.tsx`, `Queue.tsx`, `Delivery.tsx`
- `src/styles.css`
- `src/test/helpers.tsx` + `auth.test.tsx`, `queue.test.tsx`, `delivery.test.tsx`, `delivery-lib.test.ts`

Backend config: `.env`/`.env.example` `CORS_ORIGINS` += `http://localhost:5175`.

Docs: `docs/05-implementation/blynk-rider-app-report.md` (new), `implementation-status.md` (update).

---

### Task 1: Rider request hygiene (uuid params, inactive profile)

**Files:** Modify `rider.schema.ts`, `rider.controller.ts`, `rider.service.ts`. Test: create `tests/rider-delivery.test.ts`.

**Interfaces:**
- Produces: `deliveryParamsSchema = z.object({ id: z.string().uuid('Invalid delivery ID') })`; error `403 RIDER_INACTIVE`.
- Produces (test fixture, used by all later backend tasks): `riderA` (seeded Farhan, `f0000001-0000-0000-0000-000000000001`), `riderB` (created in `beforeAll` with fixed ids `a0000009-0000-0000-0000-00000000000b` / `f0000009-0000-0000-0000-00000000000b`, phone `+94770009901`, deleted in `afterAll`), and helpers `placeOrder()`, `pack(orderId)`, `assign(orderId, riderId)`, `rider(token)`.

- [ ] **Step 1: Write the fixture and failing tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Rider delivery integrity: ownership, the documented delivery/order state
 * machine, COD settlement and concurrency, enforced by the backend.
 * Every order, delivery, notification, address, rider and user created here
 * is removed in afterAll. Only seeded UNTRACKED products are ordered.
 */
describe('Rider deliveries', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const riderBUser = { id: 'a0000009-0000-0000-0000-00000000000b', phone: '+94770009901', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const RIDER_B = 'f0000009-0000-0000-0000-00000000000b';
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // Rs. 540, UNTRACKED
  const tokens = {
    customer: generateAccessToken(customer), admin: generateAccessToken(admin), staff: generateAccessToken(staff),
    riderA: generateAccessToken(riderAUser), riderB: generateAccessToken(riderBUser),
  };
  const createdOrders: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Test Rider B', 'RIDER')`,
      [riderBUser.id, riderBUser.phone]
    );
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       SELECT $1, $2, id, 'TEST-RB-0001', true, true FROM dark_stores LIMIT 1`,
      [RIDER_B, riderBUser.id]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Rider test', 'Rider Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  afterAll(async () => {
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query('DELETE FROM riders WHERE id = $1', [RIDER_B]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [riderBUser.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [riderBUser.id]);
  });

  async function placeOrder() {
    const res = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(res.status).toBe(201);
    createdOrders.push(res.body.data.order.id);
    return res.body.data.order as { id: string; total_amount: number };
  }
  const pack = (orderId: string) => request(app).patch(`/api/v1/admin/orders/${orderId}/status`)
    .set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
  const assign = (orderId: string, riderId: string) => request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`)
    .set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: riderId });
  const setStatus = (id: string, body: object, token = tokens.riderA) =>
    request(app).patch(`/api/v1/riders/deliveries/${id}/status`).set('Authorization', `Bearer ${token}`).send(body);
  const collect = (id: string, amount: number, token = tokens.riderA) =>
    request(app).post(`/api/v1/riders/deliveries/${id}/collect-cod`).set('Authorization', `Bearer ${token}`).send({ amount });
  async function assignedDelivery() {
    const order = await placeOrder();
    expect((await pack(order.id)).status).toBe(200);
    const res = await assign(order.id, RIDER_A);
    expect(res.status).toBe(200);
    return { order, deliveryId: res.body.data.delivery.id as string };
  }

  describe('request hygiene', () => {
    it('rejects a malformed delivery id with 400', async () => {
      const res = await request(app).get('/api/v1/riders/deliveries/not-a-uuid').set('Authorization', `Bearer ${tokens.riderA}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses an inactive rider profile with 403 RIDER_INACTIVE', async () => {
      await pool.query('UPDATE riders SET is_active = false WHERE id = $1', [RIDER_B]);
      try {
        const res = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.riderB}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('RIDER_INACTIVE');
      } finally {
        await pool.query('UPDATE riders SET is_active = true WHERE id = $1', [RIDER_B]);
      }
    });
  });
});
```

(The address insert is the same one `tests/order-resolution.test.ts` uses; it is inside the 4 km radius.)

- [ ] **Step 2: Run and confirm RED**

Run: `cd backend/api && npx vitest run tests/rider-delivery.test.ts`
Expected: malformed id → 500 (not 400); inactive → 200 (not 403).

- [ ] **Step 3: Implement**

`rider.schema.ts` adds:
```ts
export const deliveryParamsSchema = z.object({ id: z.string().uuid('Invalid delivery ID') });
```
`rider.controller.ts`: each handler starts with `const { id } = deliveryParamsSchema.parse(req.params);` and uses `id` instead of `req.params.id as string`.
`rider.service.ts getRiderOrThrow`:
```ts
if (!rider.is_active) {
  throw new AppError('This rider profile is inactive.', 403, 'RIDER_INACTIVE');
}
```

- [ ] **Step 4: Run and confirm GREEN**, then run `npx vitest run tests/security.test.ts tests/orders.test.ts`. Expected: all pass.

---

### Task 2: Guarded delivery transitions (R1, R2, R4, G4)

**Files:** Modify `rider.schema.ts`, `rider.repository.ts updateDeliveryStatus`, `rider.service.ts`, `tests/orders.test.ts` (fixture), test `tests/rider-delivery.test.ts`.

**Interfaces:**
- Produces: `updateDeliveryStatusSchema` status enum `['PICKED_UP','ARRIVED_AT_CUSTOMER','FAILED']`; FAILED requires `failure_reason` (1–500 trimmed).
- Error codes: `409 INVALID_DELIVERY_TRANSITION` (details `{ current_status, requested_status }`), `409 ORDER_NOT_READY_FOR_PICKUP` (details `{ order_status }`), `409 ORDER_NOT_ACTIVE` (details `{ order_status }`).

Allowed rider transitions (the whole rule set):
```ts
const RIDER_TRANSITIONS: Record<'PICKED_UP' | 'ARRIVED_AT_CUSTOMER' | 'FAILED', DeliveryAssignmentStatus[]> = {
  PICKED_UP: ['ASSIGNED', 'ACCEPTED'],
  ARRIVED_AT_CUSTOMER: ['PICKED_UP'],
  FAILED: ['PICKED_UP', 'ARRIVED_AT_CUSTOMER'],
};
// Order must be PACKED for PICKED_UP, OUT_FOR_DELIVERY for ARRIVED_AT_CUSTOMER and FAILED.
```

- [ ] **Step 1: Failing tests** (append inside `describe('Rider deliveries')`):

```ts
describe('lifecycle', () => {
  it('walks ASSIGNED → PICKED_UP → ARRIVED_AT_CUSTOMER with correct order state and history', async () => {
    const { order, deliveryId } = await assignedDelivery();
    const up = await setStatus(deliveryId, { status: 'PICKED_UP' });
    expect(up.status).toBe(200);
    expect(up.body.data.delivery.order_status).toBe('OUT_FOR_DELIVERY');
    const hist = await pool.query(
      `SELECT old_status, new_status FROM order_status_history WHERE order_id = $1 AND new_status = 'OUT_FOR_DELIVERY'`, [order.id]);
    expect(hist.rows).toEqual([{ old_status: 'PACKED', new_status: 'OUT_FOR_DELIVERY' }]);
    const arrived = await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' });
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.delivery.assignment_status).toBe('ARRIVED_AT_CUSTOMER');
  });

  it('refuses pickup of an order that is not packed', async () => {
    const order = await placeOrder();
    const a = await assign(order.id, RIDER_A); // before Task 4 this still succeeds on PLACED
    const res = await setStatus(a.body.data.delivery.id, { status: 'PICKED_UP' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_PICKUP');
    const row = await pool.query('SELECT order_status FROM orders WHERE id = $1', [order.id]);
    expect(row.rows[0].order_status).toBe('PLACED');
  });

  it('refuses pickup of an order the customer cancelled after assignment', async () => {
    const { order, deliveryId } = await assignedDelivery();
    const cancel = await request(app).post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${tokens.customer}`).send({ reason: 'changed my mind' });
    expect(cancel.status).toBe(200);
    const res = await setStatus(deliveryId, { status: 'PICKED_UP' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_ACTIVE');
    const row = await pool.query('SELECT order_status FROM orders WHERE id = $1', [order.id]);
    expect(row.rows[0].order_status).toBe('CANCELLED');
  });

  it('refuses skipping, reversing and repeating transitions', async () => {
    const { deliveryId } = await assignedDelivery();
    expect((await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
    expect((await setStatus(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    const again = await setStatus(deliveryId, { status: 'PICKED_UP' });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ current_status: 'PICKED_UP', requested_status: 'PICKED_UP' });
  });

  it.each(['ASSIGNED', 'ACCEPTED', 'REJECTED', 'DELIVERED'])('does not accept %s from a rider', async (status) => {
    const { deliveryId } = await assignedDelivery();
    const res = await setStatus(deliveryId, { status });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('FAILED needs a reason and is only allowed after pickup; order becomes FAILED', async () => {
    const { order, deliveryId } = await assignedDelivery();
    expect((await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Bike broke down' })).status).toBe(409);
    await setStatus(deliveryId, { status: 'PICKED_UP' });
    expect((await setStatus(deliveryId, { status: 'FAILED' })).status).toBe(400);
    expect((await setStatus(deliveryId, { status: 'FAILED', failure_reason: '   ' })).status).toBe(400);
    const res = await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Bike broke down' });
    expect(res.status).toBe(200);
    const row = await pool.query('SELECT order_status FROM orders WHERE id = $1', [order.id]);
    expect(row.rows[0].order_status).toBe('FAILED');
    const hist = await pool.query(`SELECT old_status FROM order_status_history WHERE order_id = $1 AND new_status = 'FAILED'`, [order.id]);
    expect(hist.rows[0].old_status).toBe('OUT_FOR_DELIVERY');
  });

  it('concurrent double pickup: exactly one succeeds, one history row', async () => {
    const { order, deliveryId } = await assignedDelivery();
    const results = await Promise.all([setStatus(deliveryId, { status: 'PICKED_UP' }), setStatus(deliveryId, { status: 'PICKED_UP' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const hist = await pool.query(`SELECT count(*)::int n FROM order_status_history WHERE order_id = $1 AND new_status = 'OUT_FOR_DELIVERY'`, [order.id]);
    expect(hist.rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: RED.** Run the file. Expected: unpacked and cancelled pickups return 200; repeats 200; ACCEPTED/DELIVERED 200; FAILED without reason 200; concurrency [200, 200].

- [ ] **Step 3: Implement.**

`rider.schema.ts`:
```ts
export const updateDeliveryStatusSchema = z
  .object({
    status: z.enum(['PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILED'], {
      invalid_type_error: 'Invalid delivery status value',
    }),
    failure_reason: z.string().trim().min(1, 'Failure reason cannot be empty').max(500, 'Failure reason cannot exceed 500 characters').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'FAILED' && !v.failure_reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['failure_reason'], message: 'A reason is required when a delivery fails' });
    }
  });
export type RiderDeliveryStatus = z.infer<typeof updateDeliveryStatusSchema>['status'];
```
(Keep the existing `invalid_type_error`; don't add `required_error` next to an errorMap, per the Phase 0 zod lesson.)

`rider.repository.ts updateDeliveryStatus`, in the transaction after locking `current`:
```ts
const order = await trx.selectFrom('orders').selectAll().where('id', '=', current.order_id).forUpdate().executeTakeFirstOrThrow();
if (order.order_status === 'CANCELLED' || order.order_status === 'DELIVERED' || order.order_status === 'FAILED') {
  throw new AppError('This order is no longer active.', 409, 'ORDER_NOT_ACTIVE', { order_status: order.order_status });
}
if (!RIDER_TRANSITIONS[newStatus].includes(current.assignment_status)) {
  throw new AppError('This delivery cannot move to that status.', 409, 'INVALID_DELIVERY_TRANSITION',
    { current_status: current.assignment_status, requested_status: newStatus });
}
const requiredOrderStatus = newStatus === 'PICKED_UP' ? 'PACKED' : 'OUT_FOR_DELIVERY';
if (order.order_status !== requiredOrderStatus) {
  throw new AppError(
    newStatus === 'PICKED_UP' ? 'This order is not packed yet.' : 'This order is not out for delivery.',
    409, newStatus === 'PICKED_UP' ? 'ORDER_NOT_READY_FOR_PICKUP' : 'INVALID_DELIVERY_TRANSITION',
    { order_status: order.order_status });
}
```
History inserts use `old_status: order.order_status` (not literals). Remove the ACCEPTED/REJECTED/DELIVERED branches, which are now unreachable. The notification block reuses `order` instead of re-selecting. The signature type becomes `RiderDeliveryStatus`. Lock order: delivery then order, same as collectCod.

`tests/orders.test.ts` "Rider Fulfillment" `beforeAll`: after creating `deliveryOrderId`, `PATCH /admin/orders/${deliveryOrderId}/status {PACKED}` with `tokenAdmin` before assigning.

- [ ] **Step 4: GREEN.** Run `tests/rider-delivery.test.ts`, `tests/orders.test.ts`, `tests/security.test.ts`. Expected: all pass. Run the concurrency test 5× (`for i in 1 2 3 4 5; do npx vitest run tests/rider-delivery.test.ts -t concurrent; done`).

---

### Task 3: Guarded COD settlement (G2, G3)

**Files:** Modify `rider.repository.ts collectCod`, `rider.service.ts collectCod`. Test `tests/rider-delivery.test.ts`.

**Interfaces:** error codes `409 INVALID_DELIVERY_TRANSITION` (not ARRIVED), `409 ORDER_NOT_ACTIVE`, `409 COD_ALREADY_COLLECTED`, `409 NOT_COD_ORDER`, `400 INVALID_COD_AMOUNT` (existing, now evaluated under lock).

- [ ] **Step 1: Failing tests**

```ts
describe('COD settlement', () => {
  async function arrivedDelivery() {
    const d = await assignedDelivery();
    expect((await setStatus(d.deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    expect((await setStatus(d.deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
    return d;
  }

  it('settles the exact backend total: delivery, payment, order and history agree', async () => {
    const { order, deliveryId } = await arrivedDelivery();
    const res = await collect(deliveryId, order.total_amount);
    expect(res.status).toBe(200);
    const row = await pool.query(`SELECT o.order_status, o.payment_status, p.payment_status AS pay, d.assignment_status, d.cod_collected_amount
      FROM orders o JOIN payments p ON p.order_id = o.id JOIN deliveries d ON d.order_id = o.id WHERE o.id = $1`, [order.id]);
    expect(row.rows[0]).toMatchObject({ order_status: 'DELIVERED', payment_status: 'PAID', pay: 'PAID', assignment_status: 'DELIVERED' });
    expect(Number(row.rows[0].cod_collected_amount)).toBe(order.total_amount);
    const hist = await pool.query(`SELECT old_status FROM order_status_history WHERE order_id = $1 AND new_status = 'DELIVERED'`, [order.id]);
    expect(hist.rows).toEqual([{ old_status: 'OUT_FOR_DELIVERY' }]);
  });

  it('refuses collection before pickup and before arrival', async () => {
    const { order, deliveryId } = await assignedDelivery();
    expect((await collect(deliveryId, order.total_amount)).body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
    await setStatus(deliveryId, { status: 'PICKED_UP' });
    expect((await collect(deliveryId, order.total_amount)).body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
  });

  it('refuses a second collection with 409 COD_ALREADY_COLLECTED and writes nothing new', async () => {
    const { order, deliveryId } = await arrivedDelivery();
    expect((await collect(deliveryId, order.total_amount)).status).toBe(200);
    const again = await collect(deliveryId, order.total_amount);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('COD_ALREADY_COLLECTED');
    const hist = await pool.query(`SELECT count(*)::int n FROM order_status_history WHERE order_id = $1 AND new_status = 'DELIVERED'`, [order.id]);
    expect(hist.rows[0].n).toBe(1);
  });

  it('concurrent double collection: exactly one succeeds', async () => {
    const { order, deliveryId } = await arrivedDelivery();
    const results = await Promise.all([collect(deliveryId, order.total_amount), collect(deliveryId, order.total_amount)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('refuses collection when an operator cancelled the order meanwhile', async () => {
    const { order, deliveryId } = await arrivedDelivery();
    expect((await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set('Authorization', `Bearer ${tokens.admin}`)
      .send({ status: 'CANCELLED' })).status).toBe(200);
    const res = await collect(deliveryId, order.total_amount);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_ACTIVE');
    const row = await pool.query('SELECT payment_status FROM payments WHERE order_id = $1', [order.id]);
    expect(row.rows[0].payment_status).toBe('PENDING');
  });

  it('checks the amount against the total read under the lock', async () => {
    const { order, deliveryId } = await arrivedDelivery();
    await pool.query('UPDATE orders SET total_amount = total_amount - 1 WHERE id = $1', [order.id]); // simulates a concurrent total change
    const res = await collect(deliveryId, order.total_amount);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_COD_AMOUNT');
  });
});
```

- [ ] **Step 2: RED.** Expected: pre-pickup collect 200, second collect 200, concurrency [200, 200], cancelled 200, stale-total 200.

- [ ] **Step 3: Implement.** Move the whole check into `riderRepository.collectCod`, after both `forUpdate` reads:
```ts
if (order.payment_status === 'PAID' || delivery.assignment_status === 'DELIVERED') {
  throw new AppError('Cash for this order has already been collected.', 409, 'COD_ALREADY_COLLECTED');
}
if (order.order_status !== 'OUT_FOR_DELIVERY') {
  throw new AppError('This order is no longer active.', 409, 'ORDER_NOT_ACTIVE', { order_status: order.order_status });
}
if (delivery.assignment_status !== 'ARRIVED_AT_CUSTOMER') {
  throw new AppError('Mark the delivery as arrived before collecting cash.', 409, 'INVALID_DELIVERY_TRANSITION',
    { current_status: delivery.assignment_status, requested_status: 'DELIVERED' });
}
if (order.payment_method !== 'COD') {
  throw new AppError('This order is not cash on delivery.', 409, 'NOT_COD_ORDER');
}
const total = Number(order.total_amount);
if (Math.abs(collectedAmount - total) > 0.01) {
  throw new AppError(`Collected cash amount (${collectedAmount.toFixed(2)} LKR) does not match total order amount (${total.toFixed(2)} LKR).`,
    400, 'INVALID_COD_AMOUNT', { expected_amount: total, provided_amount: collectedAmount });
}
```
The history `old_status` stays `order.order_status` (now always OUT_FOR_DELIVERY). `rider.service.collectCod` drops its pre-read and amount check and returns 404 `DELIVERY_NOT_FOUND` when the repository returns null. Keep the existing `orders.test.ts` INVALID_COD_AMOUNT test green.

- [ ] **Step 4: GREEN**, plus 5× concurrency runs.

---

### Task 4: Assignment hardening (R8)

**Files:** Modify `order.service.ts assignRiderAdmin`, `order.repository.ts assignRider`, `tests/orders.test.ts:495-503`. Test `tests/rider-delivery.test.ts`.

**Interfaces:** `404 RIDER_NOT_FOUND`, `409 RIDER_INACTIVE`, `409 ORDER_NOT_READY_FOR_ASSIGNMENT` (details `{ order_status }`), `409 ORDER_ALREADY_ASSIGNED`.

- [ ] **Step 1: Failing tests**

```ts
describe('assignment (admin API the rider depends on)', () => {
  it('requires a PACKED order', async () => {
    const order = await placeOrder();
    const res = await assign(order.id, RIDER_A);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');
  });
  it('rejects an unknown rider with 404 and a second active assignment with 409', async () => {
    const order = await placeOrder(); await pack(order.id);
    expect((await assign(order.id, '00000000-0000-0000-0000-00000000dead')).body.error.code).toBe('RIDER_NOT_FOUND');
    expect((await assign(order.id, RIDER_A)).status).toBe(200);
    const dup = await assign(order.id, RIDER_B);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ORDER_ALREADY_ASSIGNED');
  });
  it('refuses an inactive rider', async () => {
    const order = await placeOrder(); await pack(order.id);
    await pool.query('UPDATE riders SET is_active = false WHERE id = $1', [RIDER_B]);
    try { expect((await assign(order.id, RIDER_B)).body.error.code).toBe('RIDER_INACTIVE'); }
    finally { await pool.query('UPDATE riders SET is_active = true WHERE id = $1', [RIDER_B]); }
  });
});
```
The Task 2 test "refuses pickup of an order that is not packed" can no longer create its fixture through the API. Change it to insert the delivery row directly (`INSERT INTO deliveries (order_id, rider_id) VALUES ($1, $2) RETURNING id`), so it still proves the rider-side guard independently.

- [ ] **Step 2: RED.** PLACED assign 200; unknown rider 500; duplicate 500.

- [ ] **Step 3: Implement** in `orderRepository.assignRider`, in the transaction, before the insert:
```ts
const order = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
if (order.order_status !== 'PACKED') {
  throw new AppError('Only packed orders can be assigned to a rider.', 409, 'ORDER_NOT_READY_FOR_ASSIGNMENT', { order_status: order.order_status });
}
const rider = await trx.selectFrom('riders').selectAll().where('id', '=', riderId).executeTakeFirst();
if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
if (!rider.is_active) throw new AppError('This rider is inactive.', 409, 'RIDER_INACTIVE');
const active = await trx.selectFrom('deliveries').select('id').where('order_id', '=', orderId)
  .where('assignment_status', 'not in', ['FAILED', 'REJECTED']).executeTakeFirst();
if (active) throw new AppError('This order already has an active rider.', 409, 'ORDER_ALREADY_ASSIGNED');
```
Also catch `23505` on the insert and rethrow the same 409 (belt and braces for the unique index). The rider-name notification payload is unchanged. Update `orders.test.ts`: the duplicate test expects 409 `ORDER_ALREADY_ASSIGNED`.

- [ ] **Step 4: GREEN**, then the full backend suite.

---

### Task 5: Atomic customer cancellation (R9)

**Files:** Modify `order.repository.ts cancelOrder`, `order.service.ts cancelOrderCustomer`. Test `tests/rider-delivery.test.ts`.

- [ ] **Step 1: Failing test**

```ts
it('customer cancel racing rider pickup leaves a consistent order', async () => {
  for (let i = 0; i < 5; i++) {
    const { order, deliveryId } = await assignedDelivery();
    const [cancel, pickup] = await Promise.all([
      request(app).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${tokens.customer}`).send({}),
      setStatus(deliveryId, { status: 'PICKED_UP' }),
    ]);
    const row = await pool.query(`SELECT o.order_status, d.assignment_status FROM orders o JOIN deliveries d ON d.order_id = o.id WHERE o.id = $1`, [order.id]);
    const { order_status, assignment_status } = row.rows[0];
    if (cancel.status === 200) {
      expect(pickup.status).toBe(409);
      expect([order_status, assignment_status]).toEqual(['CANCELLED', 'ASSIGNED']);
    } else {
      expect(pickup.status).toBe(200);
      expect(cancel.body.error.code).toBe('ORDER_ALREADY_OUT_FOR_DELIVERY');
      expect([order_status, assignment_status]).toEqual(['OUT_FOR_DELIVERY', 'PICKED_UP']);
    }
  }
});
```
The race is timing-dependent, so RED may not reproduce on every run. Also add a deterministic unit-level test: run `cancelOrder` inside a transaction after setting the order to OUT_FOR_DELIVERY directly and expect 400 `ORDER_ALREADY_OUT_FOR_DELIVERY`. Today `cancelOrder` itself has no guard, so that test is RED.

- [ ] **Step 2: RED** (deterministic test).
- [ ] **Step 3: Implement.** `cancelOrder` first does `selectFrom('orders').selectAll().where('id','=',orderId).forUpdate()` and applies the **same** three checks as `cancelOrderCustomer` (OUT_FOR_DELIVERY/DELIVERED → 400 `ORDER_ALREADY_OUT_FOR_DELIVERY`; CANCELLED → 400 `ORDER_ALREADY_CANCELLED`; not PLACED/PACKED → 400 `ORDER_CANNOT_BE_CANCELLED`) before updating. History `old_status` uses the locked row's status (today it wrongly records `CANCELLED`, because it reads the updated row). The service keeps its pre-checks for the 404 path. Rules are unchanged.
- [ ] **Step 4: GREEN** + `tests/orders.test.ts` cancellation tests.

---

### Task 6: Rider queue scope, items, customer delivery trim (R5, R6, R7)

**Files:** Modify `rider.repository.ts findActiveDeliveries`, `findDeliveryById`; `order.service.ts sanitizeCustomerOrder`. Test `tests/rider-delivery.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
describe('what the rider and customer see', () => {
  it('detail lists bag items by name and quantity, with no prices, costs or internal notes', async () => {
    const { deliveryId } = await assignedDelivery();
    const res = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set('Authorization', `Bearer ${tokens.riderA}`);
    expect(res.status).toBe(200);
    const d = res.body.data.delivery;
    expect(d.items).toEqual([expect.objectContaining({ product_name_snapshot: expect.any(String), quantity: 1 })]);
    const json = JSON.stringify(d);
    for (const k of ['estimated_unit_cost', 'actual_unit_cost', 'markup_percentage_applied', 'internal_notes', 'supplier', 'customer_id'])
      expect(json).not.toContain(k);
  });

  it('rider B cannot read, move or settle rider A\'s delivery, and an order id is not a delivery id', async () => {
    const { order, deliveryId } = await assignedDelivery();
    expect((await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set('Authorization', `Bearer ${tokens.riderB}`)).status).toBe(404);
    expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.riderB)).status).toBe(404);
    expect((await collect(deliveryId, order.total_amount, tokens.riderB)).status).toBe(404);
    expect((await request(app).get(`/api/v1/riders/deliveries/${order.id}`).set('Authorization', `Bearer ${tokens.riderA}`)).status).toBe(404);
    const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.riderB}`);
    expect(list.body.data.deliveries.find((x: any) => x.delivery_id === deliveryId)).toBeUndefined();
    const row = await pool.query('SELECT assignment_status FROM deliveries WHERE id = $1', [deliveryId]);
    expect(row.rows[0].assignment_status).toBe('ASSIGNED');
  });

  it('ignores a rider_id or amount smuggled into a status update', async () => {
    const { deliveryId } = await assignedDelivery();
    await setStatus(deliveryId, { status: 'PICKED_UP', rider_id: RIDER_B, total_amount: 1 });
    const row = await pool.query('SELECT d.rider_id, o.total_amount FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = $1', [deliveryId]);
    expect(row.rows[0].rider_id).toBe(RIDER_A);
    expect(Number(row.rows[0].total_amount)).toBeGreaterThan(1);
  });

  it.each([['customer'], ['staff'], ['admin']] as const)('%s gets 403 on rider endpoints', async (who) => {
    const res = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens[who]}`);
    expect(res.status).toBe(403);
  });

  it('the list holds active work and today\'s deliveries, not older ones', async () => {
    const { deliveryId } = await assignedDelivery();
    const old = await assignedDelivery();
    await pool.query(`UPDATE deliveries SET assignment_status = 'DELIVERED', delivered_at = now() - interval '2 days' WHERE id = $1`, [old.deliveryId]);
    const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.riderA}`);
    const ids = list.body.data.deliveries.map((x: any) => x.delivery_id);
    expect(ids).toContain(deliveryId);
    expect(ids).not.toContain(old.deliveryId);
  });

  it('the customer sees the rider\'s state change through the existing order API, without rider internals', async () => {
    const { order, deliveryId } = await assignedDelivery();
    await setStatus(deliveryId, { status: 'PICKED_UP' });
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${tokens.customer}`);
    expect(res.body.data.order.order_status).toBe('OUT_FOR_DELIVERY');
    expect(Object.keys(res.body.data.order.delivery).sort()).toEqual(['assigned_at', 'assignment_status', 'delivered_at', 'picked_up_at']);
  });
});
```

- [ ] **Step 2: RED.** No items; old delivered row listed; the customer delivery has every column.
- [ ] **Step 3: Implement.**
  - `findActiveDeliveries`: add `.where((eb) => eb.or([eb('deliveries.assignment_status', 'in', ['ASSIGNED','ACCEPTED','PICKED_UP','ARRIVED_AT_CUSTOMER']), eb.and([eb('deliveries.assignment_status', '=', 'DELIVERED'), eb('deliveries.delivered_at', '>=', sql<Date>`date_trunc('day', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo'`)])]))`. Keep the explicit column list. Order by `assigned_at asc, id asc` (oldest first; the rider works in assignment order).
  - `findDeliveryById`: after the row, `items = selectFrom('order_items').select(['id','product_name_snapshot','quantity','item_status']).where('order_id','=',row.order_id).where('item_status','!=','UNAVAILABLE').orderBy('created_at').orderBy('id')`.
  - `sanitizeCustomerOrder`: `delivery: order.delivery ? pick(order.delivery, ['assignment_status','assigned_at','picked_up_at','delivered_at']) : order.delivery`.
- [ ] **Step 4: GREEN**, then the **full backend suite**. Expected: the previous total (324 + Phase 1.5 = 337 in the last report) plus the new tests, all passing, and `SELECT count(*) FROM orders/deliveries/riders/users` unchanged from the baseline.

---

### Task 7: Rider app scaffold, client, auth

**Files:** Create `apps/rider/**` config, `src/api/*`, `src/auth/AuthContext.tsx`, `src/pages/Login.tsx`, `src/main.tsx`, `src/App.tsx`, `src/test/helpers.tsx`, `src/test/auth.test.tsx`. Modify `backend/api/.env`, `.env.example` (CORS 5175).

**Interfaces (produced):**
```ts
// src/api/types.ts
export type AssignmentStatus = 'ASSIGNED' | 'ACCEPTED' | 'PICKED_UP' | 'ARRIVED_AT_CUSTOMER' | 'DELIVERED' | 'FAILED' | 'REJECTED';
export interface DeliverySummary {
  delivery_id: string; order_id: string; assignment_status: AssignmentStatus; assigned_at: string;
  accepted_at: string | null; picked_up_at: string | null; order_number: string; order_status: string;
  total_amount: number; payment_method: 'COD' | 'ONLINE'; payment_status: string;
  delivery_recipient_name: string; delivery_recipient_phone: string; delivery_address_line1: string;
  delivery_address_line2: string | null; delivery_city: string; delivery_instructions: string | null;
}
export interface DeliveryItem { id: string; product_name_snapshot: string; quantity: number; item_status: string }
export interface DeliveryDetail extends DeliverySummary {
  rider_id: string; cod_collected_amount: number; delivered_at: string | null; failed_at: string | null;
  failure_reason: string | null; items: DeliveryItem[];
}
// src/api/resources.ts
export const deliveriesApi: {
  list(): Promise<DeliverySummary[]>;
  detail(id: string): Promise<DeliveryDetail>;
  pickUp(id: string): Promise<DeliveryDetail>;
  arrive(id: string): Promise<DeliveryDetail>;
  fail(id: string, reason: string): Promise<DeliveryDetail>;
  collectCod(id: string, amount: number): Promise<{ order_status: 'DELIVERED'; payment_status: 'PAID'; cod_collected_amount: number }>;
};
// src/api/client.ts
export class ApiError extends Error { status: number; code: string; details?: unknown }
// codes added client-side: 'NETWORK' (fetch threw / offline), 'TIMEOUT' (15s AbortController)
```
Lat/lng are deliberately not typed or rendered (R11).

- [ ] **Step 1: Failing tests** (`auth.test.tsx`): a RIDER session renders the Deliveries page; CUSTOMER, PACKING_STAFF and ADMIN sessions are signed out with "This app is for Blynk riders. Sign in with a rider account."; `RIDER_PROFILE_NOT_FOUND` and `RIDER_INACTIVE` from the first `/riders/deliveries` call sign out with "Your rider profile isn't active. Contact the store."; the dev Skip button renders only when `import.meta.env.DEV` and `VITE_DEV_RIDER_PHONE` are set.
- [ ] **Step 2: RED** (module missing).
- [ ] **Step 3: Implement** by copying the Inventory client/auth patterns (`apps/inventory/src/api/client.ts`, `src/auth/AuthContext.tsx`, `src/pages/Login.tsx`): storage prefix `blynk.rider.`, role set `['RIDER']`, plus timeout/offline mapping in `apiRequest`:
```ts
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 15_000);
try { res = await fetch(url, { ...init, signal: ctrl.signal }); }
catch (e) { throw new ApiError(0, (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', 'Network request failed'); }
finally { clearTimeout(timer); }
```
- [ ] **Step 4: GREEN**, then `npx tsc --noEmit` and `npx vite build`, and confirm the production bundle doesn't contain `VITE_DEV_RIDER_PHONE`'s value or the Skip label (`grep -c "Skip sign-in" dist/assets/*.js` → 0).

---

### Task 8: Delivery state helpers

**Files:** Create `src/lib/delivery.ts`, `src/test/delivery-lib.test.ts`.

```ts
export type RiderAction =
  | { kind: 'pickUp'; label: 'Picked up' }
  | { kind: 'arrive'; label: "I've arrived" }
  | { kind: 'collect'; label: string /* `Collect Rs. 1,690` */; amount: number }
  | { kind: 'none'; reason: 'being-packed' | 'cancelled' | 'done' | 'failed' | 'not-cod' };
export function nextAction(d: DeliverySummary): RiderAction;
export function stage(d: DeliverySummary): 0 | 1 | 2 | 3; // 0 pick up, 1 on the way, 2 handover, 3 done
export function canReportFailure(d: DeliverySummary): boolean; // PICKED_UP or ARRIVED_AT_CUSTOMER, order OUT_FOR_DELIVERY
export function splitQueue(list: DeliverySummary[]): { now: DeliverySummary | null; next: DeliverySummary[]; done: DeliverySummary[] };
// now = first in-progress (ARRIVED > PICKED_UP) else first actionable ASSIGNED with order PACKED else first active; done = DELIVERED
```

- [ ] **Step 1: Tests**: a table-driven test over every (assignment_status × order_status) pair from table E, asserting `nextAction`, and `splitQueue` ordering with a picked-up delivery preferred over an older assigned one.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN.**

These are UX mirrors of the backend rules. The backend stays authoritative, and the UI still handles a 409 when they disagree.

---

### Task 9: Deliveries (home) page

**Files:** Create `src/pages/Queue.tsx`, `src/components/Header.tsx`, `src/components/Banner.tsx`, `src/lib/useOnline.ts`, `src/test/queue.test.tsx`.

- [ ] **Step 1: Tests**:
  - the empty list shows "No deliveries assigned to you right now." and a Refresh button, with no illustrations or sample data;
  - NOW shows the destination, order number, "Cash to collect Rs. 610" and its primary action;
  - NEXT rows show number · city · amount;
  - DONE TODAY shows a count and the total collected;
  - a cancelled assignment reads "Cancelled — don't pick up";
  - `NETWORK` shows the offline banner with Retry, and cached data stays visible, marked "Last updated hh:mm";
  - the list refetches on `visibilitychange` to visible and every 30s while visible (fake timers).
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN.**

---

### Task 10: Delivery page and actions

**Files:** Create `src/pages/Delivery.tsx`, `src/components/ActionBar.tsx`, `ConfirmSheet.tsx`, `FailSheet.tsx`, `StatusRail.tsx`, `src/lib/errors.ts`, `src/test/delivery.test.tsx`.

`errors.ts` messages (the rider's words, not codes):
```ts
export const MESSAGES: Record<string, string> = {
  ORDER_NOT_READY_FOR_PICKUP: "This order isn't packed yet. Check with the store.",
  ORDER_NOT_ACTIVE: 'This order was cancelled or closed. Do not deliver it.',
  INVALID_DELIVERY_TRANSITION: 'This delivery changed. Showing the latest.',
  COD_ALREADY_COLLECTED: 'Cash for this order is already recorded.',
  INVALID_COD_AMOUNT: 'The amount changed. Showing the latest total.',
  DELIVERY_NOT_FOUND: 'This delivery is no longer assigned to you.',
  NETWORK: "You're offline. Nothing was sent. Try again when you have signal.",
  TIMEOUT: "The server didn't answer. Check the delivery before trying again.",
};
```

- [ ] **Step 1: Tests**:
  - each state renders exactly one primary action from `nextAction`;
  - Picked up calls `pickUp` once and disables while pending (double-tap guard);
  - Collect opens a confirm sheet stating "Collect Rs. 610 in cash from Rider Test", and confirming calls `collectCod(id, 610)` with the **fetched** total;
  - success shows the green "Delivered · Rs. 610 collected" state;
  - Can't deliver needs a non-empty reason;
  - a 409 of any code refetches the delivery and shows the message banner;
  - `TIMEOUT` on an action refetches before offering retry (so a request that actually succeeded isn't sent twice);
  - 404 returns to the list with the message;
  - the phone renders as a `tel:` link with "Call <name>";
  - no element renders latitude, longitude, cost or supplier text.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** + a11y: every button ≥44px (CSS), focus trapped in sheets, `aria-live="polite"` on the banner.

---

### Task 11: Live E2E (real backend, real DB)

**Files:** Scratchpad `e2e/rider_live.cjs` (outside the repo, like the Inventory harness).

Flow with Edge in Pixel-7 emulation (412×915, touch, DPR 2.625):
1. As the customer (API, saved token), create a fixture address and place a real order (1 × Kotmale milk).
2. As staff, `PATCH status PACKED`. As admin, `POST assign-rider` to Farhan (`f0000001-…`). DB check: delivery ASSIGNED, order PACKED.
3. Rider signs in on `http://localhost:5175` (OTP with the dev code on screen; the session is saved to `state-rider.json` to conserve the 3/hour limit).
4. The Deliveries page shows the order in NOW with the right amount. Open it. Screenshot.
5. Tap **Picked up** → DB: delivery PICKED_UP, order OUT_FOR_DELIVERY, history PACKED→OUT_FOR_DELIVERY, notification OUT_FOR_DELIVERY queued.
6. Customer `GET /orders/:id` → `OUT_FOR_DELIVERY`, and `delivery` has only the 4 safe keys.
7. Tap **I've arrived** → DB ARRIVED_AT_CUSTOMER.
8. Cash block shows Rs. 610. Tap **Collect Rs. 610** → confirm → DB: delivery DELIVERED + 610, payment PAID, order DELIVERED/PAID, history OUT_FOR_DELIVERY→DELIVERED.
9. Customer API → DELIVERED/PAID. The Flutter app's Orders tab after pull-to-refresh shows Delivered (screenshot, marked MANUALLY VERIFIED).
10. Negative live checks: a second collect via the API with the rider token → 409; a customer token on `/riders/deliveries` → 403; the rider token on `/admin/orders` → 403.
11. `finally`: delete the order's notifications, payments, deliveries, the order and the fixture address. Assert counts are back to the baseline (orders 13, deliveries 0, riders 1).

---

### Task 12: Generic AI design audit and refinement

- [ ] Run "Audit this website/app for generic AI design patterns" against screenshots at 360×800, 412×915 and 768×1024. Check for delivery-template tropes, cards, weak type, an unclear primary action, decoration, thumb reach, status hierarchy, whitespace and colour meaning.
- [ ] List the biggest problems and a stronger direction; refine CSS and markup only. Re-run all rider app tests and the live E2E flow; functionality must not change.

---

### Task 13: Documentation

- [ ] Create `docs/05-implementation/blynk-rider-app-report.md`: architecture, auth, RBAC, assignment, lifecycle table E, COD, customer integration, API changes (Tasks 1–6 with error codes), database (no migration), tests (counts), E2E evidence, limitations (G11–G14, no dispatch UI, no maps, no availability toggle, polling not push), future capabilities.
- [ ] Update `implementation-status.md` with a Rider section ending with the status line, each item marked IMPLEMENTED/TESTED/MANUALLY VERIFIED/UNVERIFIED.

---

## Self-review

- **Spec coverage:** sections 1–29 of the brief map as follows.
  - 1 → Global Constraints and A2 out-of-scope; 2 → A1; 3 → B; 4 → A1, Task 7; 5 → D, Task 9; 6 → D, Task 6, R6; 7–8 → E, Task 2.
  - 9 → R11; 10 → F, Task 3; 11 → E, Task 3, confirm sheet in Task 10; 12 → G11, R3, FAILED in Task 2; 13 → Task 5, rules unchanged.
  - 14 → G, Task 6, Task 11; 15 → Global Constraints, future; 16 → Task 4, B; 17 → K, Task 6; 18 → Tasks 2, 3, 5.
  - 19 → L; 20 → L, D; 21 → Tasks 7, 9, 10; 22 → Global Constraints, Task 9 empty state; 23 → H; 24 → I; 25 → Tasks 1–10; 26 → Task 11; 27 → Task 12; 28 → Task 13; 29 → Global Constraints.
- **Placeholders:** none. The Task 1 address fixture is copied verbatim from `tests/order-resolution.test.ts`.
- **Type consistency:** `RiderDeliveryStatus` (Task 2) is used by the repository signature; `DeliverySummary`/`DeliveryDetail` (Task 7) are consumed by `delivery.ts` (Task 8) and the pages (Tasks 9–10); error codes in Tasks 2–4 match `errors.ts` in Task 10.
