# Blynk Inventory & Stock Integrity — Implementation Report

**Date:** 2026-09-19
**Plan:** [`docs/superpowers/plans/2026-09-19-blynk-inventory-stock-integrity.md`](../superpowers/plans/2026-09-19-blynk-inventory-stock-integrity.md)
**Decisions:**
- I1–I7, I9 and I10 approved as recommended.
- I8 approved as modified: restore only provable values, never guess.
- Added at approval:
  - I2 restoration must be atomic, ledger-backed, order-specific and idempotent;
  - I6 needs a billing regression test.

**Status:** complete. Every required check passed, except `flutter analyze`, which reports 2 info lints in files this phase did not touch (see §10).

---

## 1. What was wrong, and what is true now

| Before | Now |
|---|---|
| Cancelling an order never returned the tracked stock sourcing had taken. `ORDER_CANCELLATION_RESTORE` existed but was never written. | Cancellation (customer or admin, from every state that allows it) returns exactly what that order took, in the same transaction, as an `ORDER_CANCELLATION_RESTORE` row. |
| Two code paths wrote stock, each with its own before/after logic, and nothing prevented a third. | One stock writer (`inventory/stock-ledger.ts`); a static guard test fails if anything else changes a quantity or writes a ledger row. |
| Ledger rows were stamped when their *transaction started*, so two concurrent movements could be listed in the wrong order and the before→after chain looked broken. Reproduced deterministically. | Rows are stamped when the stock moves (`clock_timestamp()` under the row lock); the ledger read in order always explains the count. |
| The docs disagreed on the stock model: reserve at checkout vs take at sourcing. | Take at sourcing, no reservation (I1), written down in business rules §6.1. The architecture's reservation design is marked as not implemented. |
| Supplier named during sourcing: an inactive supplier was accepted, and packing staff could create suppliers. | An inactive supplier is refused by name as by id; only an admin can create one by name (I4). |
| Malformed ids returned **500** on 4 routes. | 400 `VALIDATION_ERROR`. |
| A full backend test run changed 6 tables: 19 notifications, 2 ledger rows plus the seeded Munchee stock, OTP rows, refresh tokens, `last_login_at`, and **renamed a real customer account**. It also deleted every queued notification in the database. | A full run leaves **every table identical**. `npm run test:hygiene` fails the run if it doesn't. |

## 2. When stock changes (the rule, business rules §6.1)

| Event | Tracked stock | Ledger |
|---|---|---|
| Order placed | no change (no reservation) | – |
| Item sourced (Inventory) | − units sourced | `ORDER_FULFILLMENT` |
| Pack, assign, hand over, pickup, arrive | no change | – |
| Delivered (rider or admin) | no change: taken once, at sourcing | – |
| Failed / customer unavailable | no change: the bag is still the order's | – |
| Re-stage (FAILED → PACKED) | no change; items stay PACKED and cannot be sourced again | – |
| **Cancelled** (customer: PLACED/PACKED; admin: PLACED/ITEM_UNAVAILABLE/PACKED) | **+ this order's ledger net** | `ORDER_CANCELLATION_RESTORE` |
| Abandon a failed order | re-stage, then cancel → restored | `ORDER_CANCELLATION_RESTORE` |
| Admin restock / write-off / count | ± | manual types |

- **Cancellation after pickup** is impossible for anyone.
- **Tracking switched off after sourcing:** the units still come back (I5).
- **Sourced while untracked:** nothing comes back.
- **Cancellation eligibility** is unchanged.

The lifecycle catalogue now records this per action: `stock: 'RESTORE_ORDER_STOCK'` for CUSTOMER_CANCEL and ADMIN_CANCEL, and `'NONE'` for the other 12. A test pins it.

## 3. Transactions and locking

- **Canonical order,** extended without reordering: item(s)/delivery(ies) → order → **inventory rows by ascending id** → payment. No action locks both inventory and payment rows.
- **Restore** runs inside the cancel transaction, after the order lock. It reads the order's ledger net, then locks the affected inventory rows in id order. Sourcing locks item → order → inventory, so a cancel and a sourcing of the same order are serialised on the order row:
  - either the cancel sees the committed `ORDER_FULFILLMENT` and returns it;
  - or sourcing finds the order cancelled and refuses (400).
- **Idempotency:** a cancelled order can't be cancelled again (400/422), and a second restore computes 0 and writes nothing (tested directly).

## 4. API changes (no new routes)

| Route | Change |
|---|---|
| `POST /orders/:id/cancel`, `PATCH /admin/orders/:id/status` → CANCELLED | Same request and response. Side effect: tracked stock returned, with ledger rows. |
| `POST /admin/orders/:id/items/:itemId/source` | Malformed ids → 400. `supplier_name` of an inactive supplier → 400 `SUPPLIER_INACTIVE`. Staff naming a new supplier → 403 `FORBIDDEN`. The active supplier wins when names repeat. |
| `GET /admin/orders/:id/sourcing`, `GET/PATCH /admin/suppliers/:id` | Malformed id → 400. |
| `GET /admin/inventory/adjustments`, `GET /admin/inventory/:productId` | Each ledger row adds `actor_role`; the detail rows also add `actor_name`. Both routes are staff-only; customers get 403. |

No customer-facing payload gained a field. The E2E confirms customer order payloads carry no cost, markup, supplier or inventory data.

## 5. Database

- **No migration, no enum change, no new state or adjustment type.**
- The stock writer sets `inventory_adjustments.created_at` and `inventory.updated_at` from `clock_timestamp()`.
- **One-time conservative repair (I8)**, `backend/api/scripts/repair-test-pollution-2026-09-19.cjs`: a dry run by default, one transaction, exact-count guards.

### 5.1 What could and could not be recovered (I8)

Sources searched:
- the repository seed (`dev_seed.ts`, commit `f20daf5` and working copy);
- migrations `001`–`005`;
- git history (`inventory.test.ts` is untracked, so it has no history);
- every fixture and every session script;
- backups and snapshots: none exist, and `audit_logs` is empty;
- the database.

| Item | Recoverable? | Evidence | Action |
|---|---|---|---|
| Munchee crackers inventory row | **Yes:** UNTRACKED, 0 on hand, 0 reserved | `dev_seed.ts` §6 (unchanged since `f20daf5`) | **Restored** (it was TRACKED/47, produced by the test). This is a data correction, not a stock movement, so no ledger row was fabricated for it. |
| 50 `PURCHASE_RESTOCK +50` rows | **Yes**, test-generated | Note `'Received distributor carton'` exists only at `tests/inventory.test.ts:546` | **Deleted** (exact ids) |
| 48 `ORDER_FULFILLMENT −3` rows | **Yes**, test-generated | Each is the very next movement after one of those restocks (<5 s later, chain-linked), by the test's packing-staff user, qty 3 as in the test, referencing a deleted order; this is the only test using the product | **Deleted** (exact ids) |
| 1 `DAMAGE_WRITE_OFF −100` row (2026-09-16 04:56:34 UTC, no note) | **No** | Matches no code in the repository | **Kept**, unattributed |
| 15 customer names now "Ahmed Rizvi" (list below) | **No** | These accounts appear in no seed, fixture, git file, backup or script. They don't match the known live-flow script's phone scheme, so their creator is unknown. There is no audit trail of `full_name`. | **Not modified**: historically contaminated |
| 2 accounts renamed *during this phase* by my own pre-fix test runs (+94710044097, +94710015400) | **Yes**: `full_name` NULL, `updated_at` = `created_at` | Read from the database earlier this session, before the rename. All 16 untouched accounts from the same batch have `updated_at` = `created_at`, and the recorded values match `created_at` to the millisecond. | **Restored** |

The 15 historically contaminated accounts:
- +94710003984, +94710009658, +94710015893, +94710016677, +94710024485;
- +94710042488, +94710047420, +94710054527, +94710069367, +94710074326;
- +94710076104, +94710081317, +94710087061, +94710087603, +94710093742.

**Timestamp changes made by this phase that could not be undone**, recorded as fact:
- **Audit run (before any fix):** changed the seeded customer's and admin's `last_login_at`, Munchee's `inventory.updated_at`, and account +94710076104's `updated_at`, possibly also its name. Only checksums existed then, so the old values are unknown. Rows the run *added* were all removed.
- **Munchee's `updated_at`:** changed again by later pre-fix runs. It was reset by the repair, so it now reflects the repair time.

## 6. Security

| Check | Result |
|---|---|
| Cross-order item on sourcing | Refused before any write (400 `ORDER_ITEM_MISMATCH`, kept per I9) |
| Double sourcing / sourcing a cancelled, packed or re-staged order | 409 `ITEM_ALREADY_SOURCED` / 400 `ORDER_NOT_IN_SOURCING_STATE`, no stock moved |
| Inactive supplier (by id or name) | 400 `SUPPLIER_INACTIVE`, nothing written |
| Implicit supplier creation by staff | 403, no supplier row |
| Manual adjustment by staff | 403; system types (`ORDER_*`) by hand → 400; sign rules and negative stock refused |
| Customer on the ledger or on sourcing | 403 |
| Malformed ids | 400 on every Inventory/Order route |
| Replay of a cancellation | refused; stock returned once |
| Price, markup, estimated cost | untouched by sourcing (existing tests) |

## 7. Tests

Every new behaviour was test-first, with the RED run observed before the code, except where noted. Totals: backend **696** (629 → 696, **67 new**), Inventory **61** (+3), Admin 65, Rider 49, Flutter 188.

| File | What it covers |
|---|---|
| `tests/order-lifecycle-catalogue.test.ts` (+13) | The `stock` effect for all 14 actions. |
| `tests/stock-ledger-guard.test.ts` (4) | No quantity update or ledger insert outside the stock writer. RED listed the two old writers. |
| `tests/stock-ledger.test.ts` (5) | The writer's before/after values, reference and actor; refusal below 0 and below reserved; the stamp is the movement time. It also includes the **deterministic ordering race**: a held order lock forces the earlier transaction to move stock second. RED: broken chain. |
| `tests/inventory-integrity.test.ts` (34) | See below. |
| `tests/sourcing-hardening.test.ts` (11) | Malformed ids ×5, and the supplier rules ×6. |

`inventory-integrity.test.ts` covers four groups:
- **Scenarios:**
  - cancel after sourcing (customer and admin, PLACED, ITEM_UNAVAILABLE, PACKED ×2);
  - before sourcing; untracked; I5 in both directions; two products;
  - order-specific; **idempotent** (repeat cancels plus a direct second restore); refused cancel.
- **No-movement flows:**
  - delivery; fail → re-stage → replacement rider;
  - hand-over → customer unavailable → re-stage → admin delivered;
  - fail → re-stage → cancel; delivered or on-road cancel refused.
- **12 races ×5 repetitions:**
  - customer and admin cancel ∥ source; cancel ∥ pack; customer ∥ admin cancel;
  - cancel ∥ restock; two cancels sharing two products in opposite line order;
  - source ∥ source; last units; cancel ∥ tracking switch; rider fail ∥ write-off;
  - re-stage ∥ restock; duplicate source.
  - Every repetition ends with no deadlock or 500, only allowed outcomes, correct stock and an intact ledger chain.
- **I6 billing:** partial sourcing takes 2 of 3; order subtotal and total, the line's quantity and subtotal, and the payment amount are unchanged (billed for 3); cancel returns 2.
- **I7:** the ledger names who moved the stock and their role; customers get 403.

Disclosures:
- **Tests that passed on arrival.** The no-movement flows passed as soon as they were written, because the code already moved no stock there; they are regression locks, not red-green. The fail → re-stage → cancel case was written after the restore was implemented, so its RED was not observed separately. The customer 403 on the ledger also pins existing behaviour.
- **Test hygiene** (brief §10, I10): `npm run test:hygiene` (`vitest --mode hygiene`) checksums every table before and after.
  - RED: each of the four offending files failed it (exit 1).
  - After the fixes, two consecutive full runs left the database identical, and so did the final verification run.
  - Fixes:
    - `notifications.test.ts`: per-run key prefix and scoped cleanup; no longer deletes other queued messages (it now stops with a clear message if any are waiting).
    - `inventory.test.ts`: its own product instead of the seeded one, removed afterwards.
    - `auth.test.ts`: removes its OTP rows and refresh tokens and restores the seeded users' timestamps exactly (as text, keeping microseconds).
    - `security.test.ts`: always the seeded customer, profile restored.
- **Environmental race, not introduced here.** The running API dev server starts its own notification worker (`NOTIFICATION_WORKER_ENABLED`, polling every 3 s) against the same database. In 1 of about 6 full runs it claimed a row between the notifications test's enqueue and its own worker call, and the test read `PROCESSING`. The final verification ran with the dev API stopped. The test assumes exclusive use of the outbox. The durable fix is to disable the dev worker while tests run, or to give tests their own database; that is not done here.

## 8. UI (Inventory app only; no redesign)

- **Ledger "Recorded by":** a customer's cancellation shows as "Ahmed Rizvi · customer" (muted role, existing classes), so a customer isn't read as staff.
- **Tracking dialogs:**
  - Start: "Sourcing an order for a tracked product takes from this count, and cancelling that order puts it back."
  - Stop: "Units already taken for an order still come back to this count if that order is cancelled."
- **Audit** at 1366 and 390 wide:
  - no new colours, components, charts or tiles;
  - restore rows read "Cancellation restore +n", and the before→after chain reads in order;
  - at 390 the ledger scrolls horizontally inside its existing `overflow-x: auto` container.
- **Already there before this phase** (not changed): the Stock table's "Customer" header clips while the product panel is open.

## 9. Live E2E (`scratchpad/e2e/inventory_live.cjs`)

- **Setup:** real OTP sign-ins, the Inventory app and Admin board in Edge (1366×900), the Rider app in Pixel 7 emulation, a temporary replacement rider, and a checksum of every table before and after.
- **Result:** run 1 **38/38**; run 2 **39/39** (it added the Stop-tracking copy check and the audit screenshots). The database was **identical** afterwards both times.

An earlier attempt failed on two harness bugs, which I fixed:
- a rider "landing" marker that doesn't exist on an empty queue;
- an unchecked cancel with a reason shorter than the API's 3-character minimum.

Neither was a product defect.

The flows run, with stock checked in the database after each step:
- **Opening stock (Inventory UI):** start tracking → restock +10 → 10.
- **A:** order 3 → 10 (no reservation) → staff source in the UI → 7 (`ORDER_FULFILLMENT −3`, 10→7, by staff) → pack on the board → assign → rider picks up, arrives, collects → DELIVERED, **7**, one ledger row.
- **B1:** order 2 → source → 5 → customer cancels → **7** (`ORDER_CANCELLATION_RESTORE +2`, 5→7, by the customer, with the order in the note). A repeat cancel returns 400 and moves nothing.
- **B2:** order 1 → source → pack → admin cancels on the board with a reason → **7** (+1 by the admin).
- **C:** order 2 → source → pack → assign → pickup → the rider fails it → FAILED, **5** → admin re-stages on the board → **5**, and re-sourcing gets 409 → the replacement rider is assigned on the board and delivers in the Rider app → DELIVERED, **5**, exactly one fulfilment and no restore.
- **Ledger UI:** 7 entries, 2 "Cancellation restore", and "Ahmed Rizvi · customer".
- **Negative checks:** 12, all refused with the expected codes. No stock moved and no supplier was created.
- **Final chain:** 0 +10 −3 −2 +2 −1 +1 −2 = **5** = on hand.

## 10. Verification

| Suite | Result |
|---|---|
| Backend `npm run test:hygiene` (full suite, dev API stopped) | **696/696**, 27 files, **DB HYGIENE OK** |
| Backend `tsc`, build | clean |
| Inventory | **61/61**; `tsc -b` and `vite build` clean |
| Admin | **65/65**; `tsc -b` and `vite build` clean |
| Rider | **49/49**; `tsc -b` and `vite build` clean |
| Flutter `flutter test` | **188/188** |
| Flutter `flutter analyze` | **2 info-level lints (exit 1)**, see below |
| Live E2E | 38/38, then 39/39; database identical after both |
| Database | identical to the post-repair baseline (every table) |

**`flutter analyze`:** two `use_build_context_synchronously` infos, in `otp_verification_screen.dart:79` and `login_screen_otp_sheet.dart:67`.
- **Scope:** neither file has changed since 2026-09-18 00:37, and this phase changed no Flutter code. The same two infos appear in earlier analyze runs in this session, so the previous phase's "analyze clean" line was not accurate.
- **Cause:** `_verifyOTP` takes its own `BuildContext context` parameter, and the code checks `State.mounted` before using it.
- **Fix:** a one-line `context.mounted` change in each file. It was not made here because it is outside this phase's scope, in customer sign-in code.

## 11. Remaining limitations

- **Partial sourcing:** the customer is billed for the full ordered quantity when fewer units are sourced (I6; documented, and pinned by a test).
- **Substitution:** there is no endpoint to add a substitute line. A SUBSTITUTED line counts and costs the original product.
- **Reservation:** there is no stock reservation or checkout stock check (by decision). Customer availability is Admin's `is_available`.
- **Notification-worker race:** the dev API's worker can race the notifications test (§7).
- **Historic data:** 15 customer names are contaminated historically and 1 unattributed ledger row remains (§5.1).
- **Where the harness lives:** the live E2E harness is in the session scratchpad, not in the repository (as in earlier phases).
