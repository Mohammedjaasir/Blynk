# Blynk Inventory & Stock Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **approved 2026-09-19.** I1–I7, I9 and I10 approved as recommended; I8 approved as modified (restore only provable values; see §3). Added with the approval:
- I2 restoration must be atomic, ledger-backed, order-specific and idempotent, and a repeated cancellation must never restore twice (Task 3 tests);
- I6 gets an explicit regression test that the customer stays billed for the full ordered quantity (Task 3).

**Goal:** Keep tracked stock physically and financially consistent through the whole order lifecycle. Cancelling an order that has taken tracked stock returns that stock in the same transaction. Every stock movement goes through one writer that produces a correct, ordered ledger row. A full backend test run leaves the database exactly as it found it.

**Architecture:** A single stock writer (`inventory/stock-ledger.ts`) becomes the only code that changes `inventory.quantity_on_hand` or appends to `inventory_adjustments`. A static guard test enforces this, in the same way as the order-lifecycle guard. The canonical lifecycle catalogue gains a `stock` field per action. The two cancel actions call `restoreOrderStock` inside their existing transaction, after the order lock. The amount restored is derived from the ledger itself, so it is idempotent and exact.

**Tech stack:** Node/TS Express, Kysely, PostgreSQL, zod, Vitest + supertest against the dev DB (`fileParallelism: false`), React + Vite (Inventory app), playwright-core (Edge) for the live E2E.

**Sources:**
- `docs/01-product/blynk_prd.md` §2, §3.2;
- `docs/04-business/business-rules.md` §5–6;
- `docs/02-architecture/blynk_architecture.md` §I, §12;
- `docs/02-architecture/blynk_backend_api_architecture.md` §G, §K;
- `docs/02-architecture/blynk_database_design.md`;
- Inventory plan `2026-09-18-blynk-inventory-app.md` (D1–D5, R9);
- Dispatch plan `2026-09-19-blynk-dispatch-order-operations.md` §O (canonical lifecycle, D1–D15).

## Global Constraints

- Preserve the approved architecture, business rules, the canonical lifecycle (14 actions), the lock order `item/delivery → order → payment`, and all frozen error codes (Rider, Inventory, Customer apps).
- Customer cancellation eligibility is unchanged: PLACED and PACKED (CUSTOMER_CANCEL); ADMIN_CANCEL from PLACED, ITEM_UNAVAILABLE and PACKED.
- No stock reservation, no checkout stock check, no automatic stock blocking. Nothing writes `quantity_reserved`.
- No new order or item states. No new adjustment type unless the existing six cannot represent the movement (they can; see I2).
- No migration.
- No Redis, Kafka, microservices, Kubernetes, PostGIS, event sourcing, auto-dispatch, GPS, maps, ETA or push infrastructure.
- Roles:
  - inventory adjustments and tracking mode: ADMIN only;
  - sourcing and view sourcing: ADMIN + PACKING_STAFF;
  - supplier CRUD: ADMIN only.
- The customer never receives purchase cost, markup, supplier or inventory data.
- UI changes only where the backend change needs new information shown. Keep Inventory's ledger-oriented design. No decorative charts or tiles.
- Test-first; the RED run is observed before each implementation. Commit nothing unless asked.
- Clean up all E2E data; the database is verified identical to its starting checksum.

---

## 1. Requirements

| # | Requirement | Source |
|---|---|---|
| S1 | TRACKED stock taken for an order returns when that order is cancelled, atomically with the cancel. | brief §2, §3; enum `ORDER_CANCELLATION_RESTORE` |
| S2 | Stock is never taken or returned twice for the same units. | brief §1, §6, §7 |
| S3 | No stock movement on packing, assignment, pickup, delivery, failure or re-stage. | brief §6, §7 (see I1, I3) |
| S4 | Every automatic movement has the correct type, sign, product, `reference_order_id`, actor, and before/after values. Rows sort in the order stock actually moved. | brief §4 |
| S5 | Sourcing: once per item; never on a closed order; active supplier only; cost separate from price; no markup or price change; order-scoped item ids; safe under concurrency. | brief §5 |
| S6 | Packing and re-stage never consume or restore stock. | brief §6, §7 |
| S7 | No IDOR, malformed-id 500s, role escalation, invalid quantity or type, or replay double-effects on any Inventory or Order endpoint. | brief §9 |
| S8 | A full backend run leaves every table byte-identical; no manual cleanup. | brief §10 |
| S9 | Substitution limitation analysed and documented; no substitution endpoint built. | brief §11 |
| S10 | Docs say exactly when stock changes and why. | brief §14 |

## 2. Current-state audit (verified from code, tests, live API and database)

### 2.1 Every place stock changes today

`grep` across `backend/api/src` finds exactly two writers of `inventory.quantity_on_hand` and `inventory_adjustments`, both in `inventory.repository.ts`. Seeds and `setTrackingMode` only create rows at 0.

| # | Where | When | Movement | Ledger row | Locks |
|---|---|---|---|---|---|
| W1 | `sourceOrderItemAtomic` step 6 | An order item is sourced **and** the product's inventory row is TRACKED at that moment | `on_hand −= quantity sourced`. It refuses with 409 `INSUFFICIENT_TRACKED_INVENTORY` if short. | `ORDER_FULFILLMENT`, `−q`, prev/new, `reference_order_id`, sourcing user, note "Order BL-… item sourcing fulfillment" | item → order → inventory |
| W2 | `adjustStockAtomic` (`POST /admin/inventory/:productId/adjust`, ADMIN) | Manual restock, write-off or count | `on_hand += delta`. TRACKED only; never below 0 or below reserved. | `PURCHASE_RESTOCK` / `DAMAGE_WRITE_OFF` / `INVENTORY_AUDIT_ADJUSTMENT`, prev/new, admin | inventory |

Nothing else moves stock:
- order placement does not check or reserve;
- none of these touch `inventory`: pack, resolve, assign, hand-over, pickup, arrive, fail, COD settlement, admin mark delivered/failed/unavailable, re-stage, customer cancel, admin cancel;
- `quantity_reserved` is never written;
- `ORDER_RESERVATION` and `ORDER_CANCELLATION_RESTORE` are never emitted.

### 2.2 What sourced stock means

| Mode | Sourcing does | Meaning |
|---|---|---|
| UNTRACKED (Phase 1, default) | records `actual_unit_cost`, the supplier and a `sourcing_records` row; **no stock movement** | recorded acquisition cost only (bought at market for this order) |
| TRACKED | the same, **plus** `on_hand −= q` with `ORDER_FULFILLMENT` | **consumed**: the units physically leave the counted shelf into this order's bag. Not a reservation: `quantity_reserved` stays 0 and `available = on_hand`. |

### 2.3 Lifecycle trace of a TRACKED item (today)

```
Product (TRACKED, on_hand N)
  │ checkout ─────────────── no stock check, no reservation            on_hand N
  ▼
Order PLACED, item PENDING
  │ source (W1) ─────────── item SOURCED, ORDER_FULFILLMENT −q        on_hand N−q
  ▼
  ├─ cancel (customer/admin) ─── CANCELLED ─── ✗ NOTHING RETURNED     on_hand N−q  ← F1
  │
  │ pack ─────────────────── items SOURCED→PACKED, no stock movement  on_hand N−q
  ▼
Order PACKED
  ├─ cancel (customer/admin) ─── CANCELLED ─── ✗ NOTHING RETURNED     on_hand N−q  ← F1
  │ assign / hand-over / pickup / arrive ─ no stock movement
  ▼
OUT_FOR_DELIVERY (no cancel path exists for anyone)
  ├─ collect COD / admin delivered ─ DELIVERED, no movement           on_hand N−q  ✓
  └─ fail / customer unavailable ─── FAILED|CU, no movement           on_hand N−q
        └─ admin re-stage ─ PACKED, no movement (items stay PACKED,
           sourcing refuses PACKED → cannot consume twice)            on_hand N−q  ✓
           └─ replacement rider … DELIVERED                           on_hand N−q  ✓
```

### 2.4 Findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| **F1** | Cancelling an order never returns TRACKED stock taken by sourcing. This applies to CUSTOMER_CANCEL (PLACED, PACKED) and ADMIN_CANCEL (PLACED, ITEM_UNAVAILABLE, PACKED). | `cancelOrder()` in `lifecycle/actions/shared.ts` touches only the order; `ORDER_CANCELLATION_RESTORE` has no emitter | **High:** stock under-counts permanently |
| **F2** | The docs conflict on the stock model. Architecture §I and §12 design *reserve at checkout, deduct at DELIVERED*. The implemented model, approved in Inventory D1 ("checkout reservation is not implemented"), consumes at sourcing. | `blynk_architecture.md` §I, §12 vs `sourceOrderItemAtomic` step 6 and the Inventory plan table "TRACKED" | Needs a decision (**I1**) |
| **F3** | Ledger rows are stamped with the **transaction start time** (`DEFAULT CURRENT_TIMESTAMP`), not the moment of the movement. Two transactions queued on the same inventory row can therefore be stamped in the opposite order to the one in which they moved stock. The Inventory ledger (sorted by `created_at`) then shows a broken prev→new chain. | column default, 001 schema; `listAdjustments` sorts by `created_at desc` | Medium; RED race test in Task 2 |
| **F4** | The two stock writers duplicate the prev/new/ledger logic, and nothing stops a future path writing stock without a ledger row. | two inline implementations | Medium (structural) |
| **F5** | `supplier_name` on sourcing: (a) matching an **inactive** supplier by name uses it, bypassing `SUPPLIER_INACTIVE`; (b) PACKING_STAFF can **create** suppliers implicitly, against "supplier CRUD: ADMIN only"; (c) names are not unique, so the match is arbitrary. The Inventory UI never sends `supplier_name`; the API keeps it by Inventory D2. | `sourceOrderItemAtomic` step 3; `sourcing.test.tsx:107` | Medium (**I4**) |
| **F6** | Malformed ids return **500**. Verified live: `POST /admin/orders/:id/items/:itemId/source`, `GET /admin/orders/:id/sourcing`, `GET /admin/suppliers/:id`, `PATCH /admin/suppliers/:id`. | curl, 2026-09-19 | Medium |
| F7 | Sourcing a cross-order item is refused with 400 `ORDER_ITEM_MISMATCH` before any write (tested contract). Unlike resolve's 404, it confirms the item id exists elsewhere. | curl; `inventory.test.ts:239,271` | Low (**I9**) |
| F8 | Partial sourcing (`quantity < ordered`) marks the whole item SOURCED and takes only the sourced quantity; the customer is still billed for the ordered quantity. Stock stays true to the ledger; billing doesn't reflect it. | `sourceOrderItemAtomic`; `SourceItemDialog` allows 1..ordered | Low (**I6**) |
| F9 | A FAILED or CUSTOMER_UNAVAILABLE order that is never re-staged keeps its stock consumed while the bag sits back in the store. | no transition out except RESTAGE | Low (**I3**) |
| **F10** | Tests change persistent data. A full run (checksummed before and after, 629/629 passing) changed 6 tables; see the table below. | `scratchpad/fingerprint.cjs` diff | **High** (brief §10) |
| F11 | Historic pollution from F10: (a) the seeded Munchee crackers row is TRACKED/47 (seed: UNTRACKED/0) with **99** test ledger rows. Their net is +2256, which doesn't reconcile with 47, because the test resets stock by direct `UPDATE`. (b) **15** throwaway customer accounts renamed from NULL to "Ahmed Rizvi". | DB queries | Medium (**I8**) |

What a full test run changed:

| File | What a full run leaves | Cause |
|---|---|---|
| `notifications.test.ts` | +19 `notifications` (17 ORDER_PLACED, 2 OUT_FOR_DELIVERY, `order_id NULL`) | `afterAll` deletes only by `order_id` |
| `notifications.test.ts` | **deletes every QUEUED notification in the DB** | `beforeAll`: `DELETE FROM notifications WHERE status = 'QUEUED'`, because the worker claims all queued rows |
| `inventory.test.ts` | seeded Munchee row forced to 0/UNTRACKED, left TRACKED/47; +2 ledger rows | direct `UPDATE inventory`, no restore, ledger not removed |
| `auth.test.ts` | +2 `otp_verifications`, +2 `refresh_tokens`, `last_login_at` on seeded customer and admin | OTP login of seeded phones, no cleanup |
| `security.test.ts` | renames an **arbitrary** active customer to "Ahmed Rizvi" | `getCustomerToken()` has no `ORDER BY`; mass-assignment test PATCHes `/me` |

Audit side effect, disclosed:
- The rows my audit run added are removed again (19 notifications, 2 OTP, 2 refresh tokens, 2 ledger rows), with guards and verified counts.
- Four timestamps it changed in place can't be restored, because only checksums were taken: Munchee `inventory.updated_at`, `last_login_at` of the seeded customer and admin, and `updated_at` of account +94710076104. That account's name may also have been changed by the run.

**Verified correct (kept, pinned by tests):**
- An item is sourced once: item row lock plus 409 `ITEM_ALREADY_SOURCED`.
- Sourcing a cancelled, packed or delivered order → 400 `ORDER_NOT_IN_SOURCING_STATE` (`ITEM_WORK_STATES`).
- `supplier_id` inactive → 400 `SUPPLIER_INACTIVE`.
- Sourcing leaves `estimated_unit_cost`, `unit_selling_price`, `subtotal`, product `purchase_cost` and markup untouched.
- A 409 on stock rolls back the sourcing record and any on-the-fly supplier (one transaction).
- Manual adjustments:
  - ADMIN only;
  - manual types only (`ORDER_*` refused);
  - sign rules enforced;
  - TRACKED only;
  - never below 0.
- Resolve refuses SOURCED/PACKED items, so no item can be both unavailable and have stock taken.
- No action between PACKED and DELIVERED touches stock, including RESTAGE, so a re-staged order cannot consume twice.

### 2.5 Substitution (brief §11)

§K Scenario B ("staff adds substitution item") has no endpoint. Today a SUBSTITUTED item keeps its original product, quantity and price. It must be sourced (cost recorded) before PACK (`packingBlockers`), and sourcing it takes stock of **the original product** if that product is TRACKED.

The rules are internally consistent without an add-item endpoint:
- stock, ledger and cost all follow the one product on the line;
- a substitute that is a different product cannot be represented at all, so it can never be mis-counted.

Limitation, to be documented: a real substitution with a different TRACKED product will under-count that product and over-count the original, until a proper substitution line exists (future phase).

## 3. Decisions (recommendation first)

- **I1: Stock model for TRACKED products.**
  - *Recommended:* keep the implemented and approved model. **Sourcing consumes** (physically picks) the units, and no reservation exists. Architecture §I/§12 (reserve at checkout, deduct at delivery) is recorded in the docs as unimplemented Phase-2 design. Delivery never deducts, so there's no double deduction.
  - *Alternative:* implement §12. That is stock reservation, which this brief excludes.
- **I2: Restoring stock on cancellation.**
  - *Recommended:* automatic, inside the cancel transaction, using the existing `ORDER_CANCELLATION_RESTORE`. The amount per product is the **net stock this order has taken according to the ledger** (sum of its `ORDER_FULFILLMENT` and `ORDER_CANCELLATION_RESTORE` rows). It applies to both CUSTOMER_CANCEL and ADMIN_CANCEL, from every state they allow. No new adjustment type.
  - *Alternative:* no automatic restore; an admin records an `INVENTORY_AUDIT_ADJUSTMENT`. That loses the order reference and depends on memory.
- **I3: Failed delivery, re-stage, never re-staged.**
  - *Recommended:* no stock movement on FAILED, CUSTOMER_UNAVAILABLE or RESTAGE (the bag is still that order's). To abandon a failed order, the store re-stages it and then cancels it: both transitions exist today, and the cancel restores stock (I2) and tells the customer.
  - *Alternative:* a new ADMIN_CANCEL from FAILED/CU. That is a new transition in the documented state machine.
- **I4: `supplier_name` on sourcing.**
  - *Recommended:* a name matching an inactive supplier → 400 `SUPPLIER_INACTIVE` (the same code as `supplier_id`). A name with no active match creates a supplier **only for ADMIN**; PACKING_STAFF → 403 `FORBIDDEN`. This matches "supplier CRUD: ADMIN only" in this brief and is the "stricter" option Inventory D2 listed. The Inventory UI is unaffected (it never sends a name).
  - *Alternative:* keep D2 as is and fix only the inactive bypass.
- **I5: Tracking mode changed between sourcing and cancel.**
  - *Recommended:* restore exactly what the ledger says this order took, whatever the product's current mode. Stock taken while TRACKED comes back even if the product is now UNTRACKED, so the order's ledger nets to zero. Nothing is restored for items sourced while UNTRACKED, even if the product is TRACKED now.
  - *Alternative:* skip the restore when the product is now UNTRACKED.
- **I6: Partial sourcing (F8).**
  - *Recommended:* keep the current behaviour (approved R9). Stock moves by what was actually bagged, and the billing gap is documented as a limitation.
  - *Alternative:* require the full ordered quantity; shortfalls go through "unavailable".
- **I7: Who a restore row is attributed to.**
  - *Recommended:* `created_by_user_id` = the user who cancelled (the customer or the admin). The ledger API adds `actor_role`, and Inventory shows "Ahmed Rizvi · customer" so staff don't mistake a customer for a colleague. The note says "Order BL-… cancelled by the customer/store: 2 returned to stock".
  - *Alternative:* `NULL` actor ("system") with the reason in the note.
- **I8: One-time repair of the historic pollution (F11). APPROVED AS MODIFIED 2026-09-19:** restore only what can be proven; never guess.

  Where I looked for proof:
  - repository seed (`dev_seed.ts`, committed `f20daf5` and working copy);
  - migrations `001`–`005`;
  - git history (`inventory.test.ts` is untracked, so it has no history);
  - fixtures and every scratchpad or E2E script of every session;
  - backups and snapshots: none exist (no `*.dump`, `*backup*.sql` or snapshot; `audit_logs` has 0 rows);
  - the database itself.

  | Item | Can the original be proven? | Evidence | Action |
  |---|---|---|---|
  | 15 customer names now "Ahmed Rizvi" (+94710003984, +94710009658, +94710024485, +94710054527, +94710047420, +94710042488, +94710069367, +94710087603, +94710093742, +94710015893, +94710081317, +94710087061, +94710076104, +94710074326, +94710016677) | **No** | The accounts appear in no seed, fixture, git file, backup or script. Only the `+947196436xx` accounts match the known live-flow script's phone scheme (phone = epoch mod 10⁷); the renamed `+947100…` ones don't, so their creator is unknown. Some have real orders and addresses. No audit trail of `full_name`. | **Not modified.** Reported in the implementation report as historically contaminated, with ids and phones. The cause is fixed in Task 7. |
  | Munchee (`b0000001-…-0004`) inventory row | **Yes:** UNTRACKED, on hand 0, reserved 0 | `dev_seed.ts` §6 in commit `f20daf5` and the working copy (unchanged hunk); `blynk_database_design.md` seed | **Restored** to the seed values (tracking mode and quantities; timestamps untouched). This is a data correction removing test output, not a stock movement, so no ledger row is fabricated. |
  | 50 `PURCHASE_RESTOCK +50` rows | **Yes**, test-generated | Note `'Received distributor carton'` is a literal found **only** at `backend/api/tests/inventory.test.ts:546`, in the whole repository and all scripts. The actor is the seeded admin the test signs in as. | **Deleted** (exact ids). |
  | 48 `ORDER_FULFILLMENT −3` rows | **Yes**, test-generated | Each is the immediately next ledger movement after one of those restock rows (<5 s later, `previous_quantity` = that row's `new_quantity`). The actor is the seeded packing staff the test signs in as, the quantity is 3 as in the test, and the referenced order no longer exists. `inventory.test.ts` is the only test that uses this product. | **Deleted** (exact ids). |
  | 1 `DAMAGE_WRITE_OFF −100` row (2026-09-16 04:56:34, no note, seeded admin) | **No** | 46 ms after a test restock, but it matches no code in the repository, and "looks automated" is not proof | **Kept.** Reported as unattributed. |

  All deletions and updates happen in one transaction, by exact id list, with count guards, and only after Task 7 has stopped new pollution.
- **I9: Cross-order item on sourcing (F7).**
  - *Recommended:* keep 400 `ORDER_ITEM_MISMATCH`. It is a tested contract, refused before any write, on a staff-only route with UUID ids.
  - *Alternative:* align with resolve (404 `ORDER_ITEM_NOT_FOUND`).
- **I10: Enforcing DB hygiene.**
  - *Recommended:* a Vitest `globalSetup` that checksums every table before the run and fails the run with the list of changed tables. It's enabled by `npm run test:hygiene` (`DB_HYGIENE=1`), and used in every verification.
  - *Alternative:* always on in `npm test`. That fails spuriously if anyone uses the dev apps during a run.

## 4. Stock transition matrix (the catalogue gains `stock`)

`stock` values:
- `NONE`: the action never touches `inventory`.
- `RESTORE_ORDER_STOCK`: the action returns the order's net taken stock.

Sourcing is not an order transition (it changes item status only). It is listed for completeness and keeps its own code path through the stock writer.

| Action | From → To | Roles | Stock (TRACKED) | Ledger | Locks (in order) | Errors (unchanged unless marked) |
|---|---|---|---|---|---|---|
| SOURCE_ITEM (`POST …/items/:itemId/source`) | item PENDING/SUBSTITUTED → SOURCED; order PLACED/ITEM_UNAVAILABLE unchanged | ADMIN, PACKING_STAFF | `−q`, if TRACKED now | `ORDER_FULFILLMENT −q`, ref order, sourcer | item → order → inventory row | 404 ORDER_ITEM_NOT_FOUND, 400 ORDER_ITEM_MISMATCH, 400 CANNOT_SOURCE_UNAVAILABLE_ITEM, 409 ITEM_ALREADY_SOURCED, 400 INVALID_SOURCING_QUANTITY, 400 ORDER_NOT_IN_SOURCING_STATE, 404 SUPPLIER_NOT_FOUND, 400 SUPPLIER_INACTIVE (**now also by name**), **403 FORBIDDEN (staff creating a supplier by name, I4)**, 409 INSUFFICIENT_TRACKED_INVENTORY, **400 VALIDATION_ERROR (malformed ids)** |
| #1 CUSTOMER_CANCEL | PLACED, PACKED → CANCELLED | CUSTOMER (owner) | **`+net taken` per product** | **`ORDER_CANCELLATION_RESTORE +n`**, ref order, customer | order → inventory rows (by id) | frozen customer codes |
| #13 ADMIN_CANCEL | PLACED, ITEM_UNAVAILABLE, PACKED → CANCELLED | ADMIN | **`+net taken`** | **`ORDER_CANCELLATION_RESTORE +n`**, ref order, admin | order → inventory rows (by id) | 422/400 as today |
| #2 RESOLVE_ITEM | PLACED/ITEM_UNAVAILABLE → ITEM_UNAVAILABLE | STORE | NONE (PENDING items only, so nothing taken) | – | item → order → payment | as today |
| #3 PACK | → PACKED | STORE | NONE (SOURCED → PACKED is a label) | – | items → order | as today |
| #4 ASSIGN_RIDER, #5 HAND_TO_RIDER, #6 PICKUP, #7 ARRIVE | – / → OUT_FOR_DELIVERY | ADMIN / STORE / RIDER | NONE | – | as today | as today |
| #8 RIDER_FAIL, #11 ADMIN_MARK_FAILED, #12 ADMIN_MARK_CU | OUT_FOR_DELIVERY → FAILED / CU | RIDER / ADMIN | NONE (bag back in store, still this order's; I3) | – | as today | as today |
| #14 RESTAGE | FAILED/CU → PACKED | ADMIN | NONE (never re-consumed; items stay PACKED) | – | as today | as today |
| #9 RIDER_COLLECT_COD, #10 ADMIN_MARK_DELIVERED | OUT_FOR_DELIVERY → DELIVERED | RIDER / ADMIN | NONE (consumed at sourcing, I1) | – | delivery(ies) → order → payment | as today |
| Cancel after rider pickup | – | – | not possible: no action cancels OUT_FOR_DELIVERY | – | – | 400 ORDER_ALREADY_OUT_FOR_DELIVERY / 422 INVALID_STATUS_TRANSITION |
| Manual adjust | – | ADMIN | `±d` | manual type | inventory row | as today; **400 on malformed product id** (exists) |
| Tracking mode | – | ADMIN | NONE | – | inventory row | as today |

Scenarios from brief §2:

| Scenario | Result |
|---|---|
| Cancel before sourcing | nothing was taken, nothing restored (net 0) |
| Cancel after sourcing (PLACED/ITEM_UNAVAILABLE) | restored |
| Cancel after packing | restored |
| Cancel after rider pickup | impossible |
| Failed delivery | unchanged |
| Failed → re-stage → replacement rider → delivered | taken exactly once, at sourcing |
| Failed → re-stage → cancel | restored |
| Delivered | unchanged (final) |

## 5. Transaction and locking design

Canonical lock order, extended without reordering: **item(s) or delivery(ies) → order → inventory rows (ascending id) → payment.** No action locks both inventory and payment rows today, and after this plan none does.

| Path | Locks | Why no deadlock |
|---|---|---|
| Sourcing | item → order → one inventory row | inventory is taken last, and nothing is waited on afterwards |
| Cancel (restore) | order → inventory rows by ascending id | same direction as sourcing (order before inventory); several rows always in id order |
| Manual adjust / tracking mode | one inventory row | a single lock |
| Pack, resolve, dispatch, settle, restage | unchanged; never inventory | – |

- **Restore reads the ledger after taking the order lock.** Sourcing holds the order lock until it commits, so a cancel that gets the order lock second sees the sourcing's committed `ORDER_FULFILLMENT` row (READ COMMITTED, one snapshot per statement). A cancel that gets it first leaves sourcing to see CANCELLED and refuse with 400.
- **Idempotency:** a cancelled order can't be cancelled again (lifecycle), and the restore amount is the ledger net, so a second restore computes 0 and writes nothing.
- **Ledger ordering (F3):** the stock writer stamps `created_at = clock_timestamp()` at insert, while holding the inventory row lock, so ledger order equals movement order. This is a value written by the code, not a schema change.

## 6. API impact

| Endpoint | Change |
|---|---|
| `POST /orders/:id/cancel`, `PATCH /admin/orders/:id/status` (CANCELLED) | same request and response. Side effect: TRACKED stock taken by the order returns, with ledger rows |
| `POST /admin/orders/:id/items/:itemId/source` | malformed ids → 400 `VALIDATION_ERROR`; `supplier_name` → inactive → 400 `SUPPLIER_INACTIVE`; staff creating a supplier by name → 403 `FORBIDDEN` (I4) |
| `GET /admin/orders/:id/sourcing` | malformed id → 400 |
| `GET/PATCH /admin/suppliers/:id` | malformed id → 400 |
| `GET /admin/inventory/adjustments`, `GET /admin/inventory/:productId` | each ledger row adds `actor_role` (I7). Staff-only routes; no customer exposure |

No new endpoints. No customer-facing response gains any field.

## 7. Database impact

- No migration and no enum change: `ORDER_CANCELLATION_RESTORE` already exists.
- `inventory_adjustments.created_at` is written as `clock_timestamp()` by the stock writer (the column default remains).
- One-time data repair only if I8 is approved (guarded, exact counts, transactional).

## 8. Test plan

All integration tests use **test-owned products** (SKU prefix `INTEG-`), never seeded ones, and remove everything they create. Each file is checked by the hygiene run.

| File | Covers |
|---|---|
| `tests/order-lifecycle-catalogue.test.ts` (extend) | `stock` is `RESTORE_ORDER_STOCK` for exactly CUSTOMER_CANCEL and ADMIN_CANCEL, and `NONE` for the other 12 |
| `tests/stock-ledger-guard.test.ts` (new) | static scan: outside `inventory/stock-ledger.ts` no code updates `quantity_on_hand` or `quantity_reserved`, or inserts into `inventory_adjustments` (Kysely or raw SQL). Seeds and tests are excluded; `insertInto('inventory')` with 0 quantities in `setTrackingMode` is allowed |
| `tests/stock-ledger.test.ts` (new, unit + DB) | `recordStockMovement`: prev/new/delta/type/ref/actor; refuses a result below 0 and below reserved; `created_at` is the movement time; `restoreOrderStock`: net-from-ledger, multi-product, zero when nothing taken, zero when already restored |
| `tests/inventory-integrity.test.ts` (new, integration) | the §4 scenario table end to end, each asserting on-hand, the order's ledger net, row fields, and the chain check. Cases: cancel before sourcing; after sourcing (customer and admin); after packing (customer and admin); ITEM_UNAVAILABLE admin cancel with one sourced and one unavailable item; untracked item; mode switched after sourcing (I5, both directions); partial quantity; two lines of the same product; fail → restage → reassign → deliver (one fulfilment, no restore); fail → restage → cancel (restored); delivered then cancel refused (stock unchanged); pack and restage write no ledger row |
| same file: races (×5 each, no `40P01`, consistent end state, chain valid) | customer cancel ∥ source; admin cancel ∥ source; cancel ∥ pack; customer cancel ∥ admin cancel (one CANCELLED, one restore row per product); cancel ∥ manual adjust (same product); two cancels sharing products A and B, items in opposite orders; source ∥ source, different orders, same product (**F3 RED**); source ∥ source for the last units (one 409, never negative); cancel ∥ tracking mode switch; rider fail ∥ adjust; restage ∥ adjust; duplicate source of one item (one `ORDER_FULFILLMENT`) |
| `tests/inventory.test.ts` (extend) | supplier_name inactive → 400; staff name-create → 403, admin → 200 (I4); malformed ids → 400 on source, sourcing and suppliers/:id |
| hygiene (`DB_HYGIENE=1`) | the full run leaves all tables identical |

**Chain check helper** (`tests/helpers/ledger.ts`): for one inventory row, it reads the ledger rows since a marker, ordered by `(created_at, id)`, and asserts:
- `prev[0] = start`;
- `prev[i] = new[i-1]`;
- `new = prev + delta`;
- the last `new = on_hand`.

## 9. Live E2E plan (`scratchpad/e2e/inventory_live.cjs`)

- **Environment:** real API and PostgreSQL. Real OTP for admin, staff, customer and rider (one each, within the 3/hour limit). Inventory UI (5174) and Admin board (5173) in Edge at 1366×900; Rider app (5175) in Pixel 7 emulation.
- **Setup:** checksum every table (`fp_before`). A second, temporary rider is created by the harness and removed at the end.
- **DB checks:** after every step, `on_hand` and the order's ledger rows (type, delta, prev/new, ref, actor), plus the chain check.

**A. Tracked happy path.**
1. Admin creates the test product (Admin API).
2. In the Inventory UI: Start tracking, then Restock +10 → **10**.
3. The customer orders 3 (API) → **10** (no reservation).
4. Staff source it in the Inventory UI → **7**, `ORDER_FULFILLMENT −3` by staff.
5. Pack on the Admin board → **7**, no ledger row.
6. Admin assigns rider 1.
7. In the Rider UI: pick up → arrive → collect → DELIVERED → **7**, no ledger row.
8. The Inventory Ledger UI shows "Order fulfilment −3".

**B1. Cancel after sourcing.** The customer orders 2, staff source (**5**), the customer cancels (API, the Flutter app's endpoint) → **7**, `ORDER_CANCELLATION_RESTORE +2` by the customer. The Ledger UI shows "Cancellation restore +2 · customer".

**B2. Cancel after packing.** Order 1 → source (**6**) → pack → admin cancels on the board with a reason → **7**, restore +1 by the admin.

**C. Failure and recovery.**
1. Order 2 → source (**5**) → pack → assign rider 1 → pickup → the rider fails the delivery → FAILED → **5**.
2. Admin re-stages on the board → PACKED → **5**.
3. Assign temporary rider 2 → pickup → collect → DELIVERED → **5**. The order has exactly one `ORDER_FULFILLMENT −2` and no restore.

**Negative checks:**
- re-source a PACKED item → 409;
- source on a cancelled order → 400;
- staff adjust → 403;
- malformed ids → 400;
- inactive supplier (id and name) → 400;
- staff supplier-by-name → 403;
- customer reads the ledger → 403;
- customer order payloads carry no cost, supplier or inventory fields.

**Final:** the product's chain from 0: +10 −3 −2 +2 −1 +1 −2 = **5** = on hand.

**Cleanup:** remove everything the run created, in one transaction with exact counts:
- orders (with items, history, payments, deliveries, sourcing records and notifications);
- the test product, its inventory row and ledger;
- the temporary rider and its user;
- OTP and refresh-token rows created by the run;
- restore `last_login_at` to the values captured at start.

Then `fp_after` must be **IDENTICAL** to `fp_before`. Run twice (before and after any UI refinement).

---

## 10. Tasks

### Task 1: Catalogue declares each action's stock effect

**Files:** Modify `backend/api/src/modules/orders/lifecycle/catalogue.ts`. Test: `backend/api/tests/order-lifecycle-catalogue.test.ts`.

**Interfaces:** Produces `export type StockEffect = 'NONE' | 'RESTORE_ORDER_STOCK'` and `CatalogueEntry.stock: StockEffect`.

- [ ] **Step 1: Failing test** (append to the catalogue test)
```ts
describe('stock effect per action (inventory plan §4)', () => {
  const restoring = ACTION_NAMES.filter((a) => CATALOGUE[a].stock === 'RESTORE_ORDER_STOCK');
  it('only the two cancellations return stock', () => {
    expect(restoring.sort()).toEqual(['ADMIN_CANCEL', 'CUSTOMER_CANCEL']);
  });
  it.each(ACTION_NAMES.filter((a) => !['ADMIN_CANCEL', 'CUSTOMER_CANCEL'].includes(a)))('%s never moves stock', (a) => {
    expect(CATALOGUE[a].stock).toBe('NONE');
  });
});
```
- [ ] **Step 2:** `npx vitest run tests/order-lifecycle-catalogue.test.ts` → FAIL (`stock` undefined).
- [ ] **Step 3:** Add `stock: StockEffect` to `CatalogueEntry`. Set `stock: 'RESTORE_ORDER_STOCK'` on CUSTOMER_CANCEL and ADMIN_CANCEL and `stock: 'NONE'` on the other 12. Extend the `LockKind` doc comment: "…then the order, then inventory rows (ascending id), then the payment".
- [ ] **Step 4:** Re-run → PASS; `npx tsc --noEmit` clean.

### Task 2: One stock writer, a ledger in movement order, and a guard

**Files:**
- Create `backend/api/src/modules/inventory/stock-ledger.ts`.
- Modify `inventory.repository.ts`: sourcing step 6 and `adjustStockAtomic` call the writer.
- Create `tests/stock-ledger-guard.test.ts`, `tests/stock-ledger.test.ts`, `tests/helpers/ledger.ts`, `tests/helpers/fixtures.ts` (test-owned tracked product factory).

**Interfaces (produces):**
```ts
export type InventoryRow = Selectable<InventoryTable>;
export async function lockInventoryRow(trx: Trx, darkStoreId: string, productId: string): Promise<InventoryRow | undefined>;
export async function recordStockMovement(trx: Trx, m: {
  inventory: InventoryRow;            // locked by the caller in this transaction
  delta: number;                      // non-zero integer
  type: InventoryAdjustmentType;
  orderId: string | null;
  actorId: string | null;
  notes: string | null;
}): Promise<{ inventory: InventoryRow; adjustment: Selectable<InventoryAdjustmentsTable> }>;
```

- [ ] **Step 1: Failing guard test.** Scan `src/**/*.ts` except `modules/inventory/stock-ledger.ts` and `database/seeds/**`. Fail on:
  - `insertInto('inventory_adjustments')`;
  - `/INSERT INTO inventory_adjustments/`;
  - `/UPDATE inventory\b/`;
  - an `updateTable('inventory')` whose chained `.set({...})` names `quantity_on_hand` or `quantity_reserved`.

  Same structure and case-sensitivity as `order-lifecycle-guard.test.ts`.
- [ ] **Step 2: Failing race test (F3)** in `tests/stock-ledger.test.ts`. Create a tracked test product with 20 on hand and two orders of it, qty 2 each. Source both items concurrently with `Promise.all`, 5 repetitions. Assert `expectLedgerChain(inventoryId, 20)` passes and on-hand is 16.
- [ ] **Step 3:** Run both → the guard FAILS (two writers in the repository) and the chain test FAILS intermittently or deterministically. Record which; if the race doesn't reproduce in 5 repetitions, raise it to 20 before declaring RED. If it still doesn't reproduce, note that the fix is justified by the column default alone.
- [ ] **Step 4: Implement `stock-ledger.ts`:**
```ts
export async function recordStockMovement(trx: Trx, m: StockMovement) {
  const previous = m.inventory.quantity_on_hand;
  const next = previous + m.delta;
  if (next < 0) {
    throw new AppError(`Adjustment would cause negative on-hand inventory (${next}).`, 400,
      'NEGATIVE_INVENTORY_PROHIBITED', { previous_quantity: previous, delta: m.delta, resulting_quantity: next });
  }
  if (next < m.inventory.quantity_reserved) {
    throw new AppError(`Adjustment would cause available inventory to drop below zero (On-hand: ${next}, Reserved: ${m.inventory.quantity_reserved}).`,
      400, 'INSUFFICIENT_AVAILABLE_INVENTORY', { resulting_on_hand: next, reserved: m.inventory.quantity_reserved });
  }
  const inventory = await trx.updateTable('inventory')
    .set({ quantity_on_hand: next, updated_at: sql`clock_timestamp()` })
    .where('id', '=', m.inventory.id).returningAll().executeTakeFirstOrThrow();
  const adjustment = await trx.insertInto('inventory_adjustments').values({
    inventory_id: m.inventory.id, adjustment_type: m.type, quantity_delta: m.delta,
    previous_quantity: previous, new_quantity: next, reference_order_id: m.orderId,
    notes: m.notes, created_by_user_id: m.actorId,
    // The movement's own time, under the row lock: ledger order = the order stock moved (F3).
    created_at: sql`clock_timestamp()`,
  }).returningAll().executeTakeFirstOrThrow();
  return { inventory, adjustment };
}
```
  `lockInventoryRow` is the existing `SELECT … FOR UPDATE` by `(dark_store_id, product_id)`, moved here.
- [ ] **Step 5:** Replace sourcing step 6 and `adjustStockAtomic` steps 1–3 with `lockInventoryRow` plus `recordStockMovement`. Keep `INSUFFICIENT_TRACKED_INVENTORY` (409) in sourcing before the call, and `PRODUCT_NOT_TRACKED` in adjust. Messages and codes are unchanged.
- [ ] **Step 6:** Run the guard, the stock-ledger tests, `inventory.test.ts` and `inventory-app-contracts.test.ts` → PASS; `tsc` clean.

### Task 3: Cancellation returns the stock the order took

**Files:** Modify `stock-ledger.ts` (add `restoreOrderStock`) and `lifecycle/actions/shared.ts` (`cancelOrder`). Test: `tests/inventory-integrity.test.ts` (scenario block).

**Interfaces:**
```ts
export async function restoreOrderStock(trx: Trx, order: { id: string; order_number: string },
  actor: Actor, by: 'customer' | 'store'): Promise<{ inventory_id: string; quantity: number }[]>;
```

- [ ] **Step 1: Failing tests.** One `it` per §4 scenario row. The key one:
```ts
it('customer cancel after sourcing returns the sourced units, once, attributed to the customer', async () => {
  const p = await trackedProduct({ onHand: 10 });
  const order = await placeOrder(customer, [{ product_id: p.productId, quantity: 3 }]);
  await sourceAll(order.id, staff);                       // 10 -> 7
  const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth(customer)).send({});
  expect(res.status).toBe(200);
  expect(await onHand(p)).toBe(10);
  const rows = await ledgerForOrder(order.id);
  expect(rows.map((r) => [r.adjustment_type, r.quantity_delta])).toEqual([
    ['ORDER_FULFILLMENT', -3], ['ORDER_CANCELLATION_RESTORE', 3],
  ]);
  expect(rows[1]).toMatchObject({ previous_quantity: 7, new_quantity: 10, created_by_user_id: customer.id });
  expect(rows[1].notes).toBe(`Order ${order.order_number} cancelled by the customer: 3 returned to stock`);
  await expectLedgerChain(p.inventoryId, 10);
});
```
  Also cover:
  - admin cancel from PLACED, ITEM_UNAVAILABLE (one sourced and one unavailable item) and PACKED;
  - cancel before sourcing (no ledger row);
  - an untracked product (no row);
  - tracked → sourced → switched UNTRACKED → cancel (restored, I5);
  - untracked → sourced → switched TRACKED → cancel (nothing);
  - partial quantity 2 of 3 (restores 2);
  - two products (two rows, ascending inventory id);
  - a failed cancel (wrong state) leaves stock and ledger unchanged;
  - **idempotency (I2):** a second customer cancel → 400 `ORDER_ALREADY_CANCELLED`, and a second admin cancel → 422; on-hand and ledger are unchanged by the repeat. Calling `restoreOrderStock` again directly for a cancelled order writes nothing and returns `[]`;
  - **order-specific (I2):** two orders of the same product, one cancelled, restores only that order's units;
  - **partial sourcing billing (I6):** source 2 of 3 → stock −2. The order's `subtotal_amount`, `total_amount`, the item `subtotal` and `payments.amount` are unchanged (billed for 3); cancel → +2.
- [ ] **Step 2:** Run → FAIL (on-hand 7, no restore row).
- [ ] **Step 3: Implement.**
```ts
export async function restoreOrderStock(trx, order, actor, by) {
  const taken = await trx.selectFrom('inventory_adjustments')
    .select(['inventory_id', sql<number>`-sum(quantity_delta)::int`.as('quantity')])
    .where('reference_order_id', '=', order.id)
    .where('adjustment_type', 'in', ['ORDER_FULFILLMENT', 'ORDER_CANCELLATION_RESTORE'])
    .groupBy('inventory_id').having(sql`sum(quantity_delta)`, '<', 0)
    .orderBy('inventory_id').execute();
  const restored = [];
  for (const { inventory_id, quantity } of taken) {         // ascending id: canonical lock order
    const row = await trx.selectFrom('inventory').selectAll().where('id', '=', inventory_id).forUpdate().executeTakeFirstOrThrow();
    await recordStockMovement(trx, { inventory: row, delta: quantity, type: 'ORDER_CANCELLATION_RESTORE',
      orderId: order.id, actorId: actor.id,
      notes: `Order ${order.order_number} cancelled by the ${by}: ${quantity} returned to stock` });
    restored.push({ inventory_id, quantity });
  }
  return restored;
}
```
  In `cancelOrder` (shared.ts), after `setOrderStatus`: `await restoreOrderStock(trx, order, actor, actor.role === 'CUSTOMER' ? 'customer' : 'store');`. The doc comment names the lock order: order → inventory rows.
- [ ] **Step 4:** Run the integrity scenarios, `order-lifecycle.test.ts`, `orders.test.ts` and `customer-orders.test.ts` → PASS.

### Task 4: Lock in "no stock movement" for pack, failure, re-stage and delivery

**Files:** `tests/inventory-integrity.test.ts`.

- [ ] **Step 1:** Write the scenarios:
  - source → pack → assign → pickup → collect: exactly one `ORDER_FULFILLMENT`, on-hand unchanged after sourcing;
  - pickup → rider fail → restage → assign a second rider → pickup → collect: the same single row;
  - fail → restage → admin cancel: restored;
  - delivered → admin/customer cancel refused: stock unchanged;
  - re-source a PACKED item after restage → 409 `ITEM_ALREADY_SOURCED`, no row.
- [ ] **Step 2:** Run. These are **characterization tests**: they are expected to pass on arrival (the current code already doesn't move stock), except fail → restage → cancel, which is RED until Task 3. Report both facts; don't present the passes as RED/GREEN.

### Task 5: Concurrency suite

**Files:** `tests/inventory-integrity.test.ts` (`describe('races')`), using the `repeat(5, …)` helper pattern from `order-lifecycle.test.ts`.

- [ ] **Step 1:** Write the 12 races listed in §8. Each asserts:
  - no rejection with `40P01`;
  - allowed outcomes only (e.g. cancel ∥ source: either `[200 cancel, 400 ORDER_NOT_IN_SOURCING_STATE]` and no fulfilment row, or both 200 and fulfilment + restore);
  - on-hand = start + the sum of successful manual adjustments;
  - the order's ledger net = 0 for cancelled orders;
  - `expectLedgerChain` holds.
- [ ] **Step 2:** Run → PASS after Tasks 2–3. Any failure is a real defect: stop and root-cause it (systematic-debugging); don't loosen the assertion.

### Task 6: Sourcing and supplier endpoint hardening

**Files:** `inventory.schema.ts`, `inventory.controller.ts`, `inventory.repository.ts` (supplier resolution), `inventory.service.ts` (pass the role). Test: `tests/inventory.test.ts`.

**Interfaces:** `orderItemSourceParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })`, `orderIdParamsSchema`, `supplierIdParamsSchema`; `SourceItemParams.actorRole: UserRole`.

- [ ] **Step 1: Failing tests:**
  - malformed `:id`/`:itemId` on source → 400 `VALIDATION_ERROR`;
  - malformed `:id` on sourcing → 400;
  - malformed `:id` on GET/PATCH suppliers → 400;
  - `supplier_name` equal to an inactive supplier's name → 400 `SUPPLIER_INACTIVE`, and nothing written;
  - staff with a new `supplier_name` → 403 `FORBIDDEN`, and no supplier row;
  - admin with a new name → 200 and one supplier created (existing behaviour);
  - an existing active name used by staff → 200.
- [ ] **Step 2:** Run → FAIL (500s; 200 on the inactive name; 200 for staff).
- [ ] **Step 3:** Parse params in the three controllers. In supplier resolution by name:
  - look up **active** first (`orderBy('created_at').orderBy('id')` for determinism);
  - otherwise, if an inactive one exists → `SUPPLIER_INACTIVE`;
  - otherwise, if `actorRole !== 'ADMIN'` → `new AppError('Only an admin can add a supplier.', 403, 'FORBIDDEN')`;
  - otherwise create.
- [ ] **Step 4:** Run `inventory.test.ts`, `inventory-app-contracts.test.ts` and `security.test.ts` → PASS.

### Task 7: A full test run leaves the database untouched

**Files:**
- Create `tests/setup/db-hygiene.ts` (a Vitest `globalSetup` that checksums every table before and after the run when `DB_HYGIENE=1`, and on mismatch throws with the table list).
- Modify `vitest.config.ts` (`globalSetup`) and `package.json` (`"test:hygiene": "cross-env DB_HYGIENE=1 vitest run"`, or the equivalent without a new dependency: `node -e` setting env).
- Fix `tests/notifications.test.ts`, `tests/inventory.test.ts`, `tests/auth.test.ts` and `tests/security.test.ts`.

- [ ] **Step 1 (RED):** Add the hygiene setup, then `npm run test:hygiene` → FAIL listing `notifications`, `inventory`, `inventory_adjustments`, `otp_verifications`, `refresh_tokens`, `users`.
- [ ] **Step 2: Fixes, one file at a time, each re-run with the hygiene check:**
  - `notifications.test.ts`:
    - every idempotency key gets a run prefix `const RUN = \`nt_${Date.now()}_\``;
    - `afterAll` deletes `WHERE idempotency_key LIKE RUN || '%'`, plus the orders as today;
    - replace `DELETE … WHERE status = 'QUEUED'` with a `beforeAll` precondition that counts rows the worker could claim (the `claimPendingBatch` predicate) and fails with "N claimable notifications already queued; the worker tests would send them: drain the queue first". It never deletes or sends other data.
  - `inventory.test.ts`: the "Tracked Inventory & Stock Ledger" block uses a test-owned product and inventory row (fixture from Task 2); no `UPDATE` of seeded inventory; `afterAll` deletes that product's inventory (ledger cascades) and the product.
  - `auth.test.ts`: `beforeAll` captures `runStart` and the seeded users' `last_login_at`/`updated_at`; `afterAll` deletes `otp_verifications` and `refresh_tokens` for the seeded phones and users created `>= runStart`, and restores the captured timestamps.
  - `security.test.ts`: `getCustomerToken()` uses the seeded customer by id (`a0000001-…-0001`); the mass-assignment test captures `full_name` and `updated_at` and restores them in `afterEach`.
- [ ] **Step 3:** `npm run test:hygiene` → full suite PASS **and** hygiene IDENTICAL. Then run once more (two consecutive runs clean).

### Task 8: Conservative one-time repair (I8 as modified)

**Files:** `backend/api/scripts/repair-test-pollution-2026-09-19.cjs`, kept in the repo as the record of what was changed and why.

- [ ] **Step 1: Dry run.** Select the rows by the proof criteria in I8 (not by "looks like a test"):
  - restocks: `adjustment_type='PURCHASE_RESTOCK' AND notes='Received distributor carton'` on the Munchee inventory row;
  - fulfilments: `ORDER_FULFILLMENT`, delta −3, by `a0000001-…-0004`, referenced order missing, **and** the immediately preceding ledger row is one of those restocks with `new_quantity = previous_quantity`, less than 5 s earlier.

  Expect exactly 50 + 48 = 98. Print the kept row (the −100 write-off) and the 15 accounts, which are listed and **not** touched.
- [ ] **Step 2: Apply**, in one transaction:
  - delete exactly those 98 ids (guard `rowCount === 98`);
  - `UPDATE inventory SET tracking_mode='UNTRACKED', quantity_on_hand=0, quantity_reserved=0` for the Munchee row (guard 1 row; values from `dev_seed.ts`);
  - commit only if every guard holds.

  No `users` update.
- [ ] **Step 3:** Take a new checksum; it becomes the baseline for Task 11's E2E.

### Task 9: Inventory UI shows who returned the stock

**Files:** backend `listAdjustments` and `getInventoryByProduct` (select `u.role as actor_role`); `apps/inventory/src/api/types.ts`, `pages/Ledger.tsx`, `pages/StockPanel.tsx`. Tests: `apps/inventory/src/test/ledger.test.tsx`, `stock-panel` test.

- [ ] **Step 1: Failing tests:**
  - the ledger renders "Ahmed Rizvi · customer" for an entry with `actor_role: 'CUSTOMER'`, and the plain name for staff roles;
  - a "Cancellation restore" row shows `+2`;
  - the tracked-stock sentence in StockPanel reads "Sourcing takes from this count; cancelling a sourced order puts it back."
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with existing classes (`cell__secondary`), with no new colour, component or chart.
- [ ] **Step 4:** Inventory tests, tsc and build → PASS.

### Task 10: Documentation

- [ ] `docs/04-business/business-rules.md` §6: "When stock changes": sourcing (TRACKED) consumes; cancellation returns; nothing else moves stock; FAILED/re-stage; partial sourcing; substitution limitation.
- [ ] `docs/02-architecture/blynk_architecture.md` §I and §12: mark reserve-at-checkout / deduct-at-delivery as **not implemented Phase-2 design**, and link to the implemented model.
- [ ] `docs/superpowers/plans/2026-09-19-blynk-dispatch-order-operations.md` §O: add the `stock` column and the extended lock order.
- [ ] `docs/05-implementation/blynk-inventory-stock-integrity-report.md` (new) and an `implementation-status.md` section.

### Task 11: Full verification, live E2E, visual audit

- [ ] Run `npm run test:hygiene` (backend, the full suite **and** identical DB), then backend `tsc` and build.
- [ ] Run Inventory, Admin and Rider: `vitest run`, `tsc -b`, `vite build`.
- [ ] Run Flutter: `flutter test` and `flutter analyze`.
- [ ] Restart the API on the new code, then run the live E2E (§9) twice, each ending with the checksum IDENTICAL.
- [ ] Visual audit of the Ledger and StockPanel changes at 1366 and 390 wide against the existing Inventory direction, fixing any generic-dashboard drift.
- [ ] Final report: requirements, files, API, DB, the stock matrix, security fixes, concurrency tests, UI, E2E, and limitations. Don't declare completion unless everything passes.

## 11. Self-review

- Spec coverage:
  - §1 → §2.1–2.3;
  - §2 → I1–I3, §4;
  - §3 → §5, Task 5;
  - §4 → Task 2, I7;
  - §5 → §2.4, Task 6;
  - §6–7 → Task 4;
  - §8 → unchanged eligibility (Global Constraints);
  - §9 → Task 6, §6;
  - §10 → Task 7;
  - §11 → §2.5;
  - §12 → Task 9;
  - §13 → Task 11, §9;
  - §14 → Task 10.
- No new adjustment type, state, migration or infrastructure.
- Lock order extended, not reordered.
- Names are consistent across tasks: `recordStockMovement`, `lockInventoryRow`, `restoreOrderStock`, `StockEffect`, `expectLedgerChain`.
