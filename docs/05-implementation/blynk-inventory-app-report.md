# Blynk Inventory App — Phase 1 Foundation

Status labels: **IMPLEMENTED** (code exists), **TESTED** (automated tests),
**LIVE VERIFIED** (run end to end in a real browser against the real backend and
PostgreSQL), **UNVERIFIED** (not confirmed).

Plan: `docs/superpowers/plans/2026-09-18-blynk-inventory-app.md` (decisions
D1–D5 approved). Backend Phase 0 is complete and was not changed in this phase.

---

## 1. Application architecture

```
                         BLYNK BACKEND (one API, one PostgreSQL)
                                        │
        ┌────────────────┬──────────────┼──────────────┬────────────────┐
        ▼                ▼              ▼              ▼
   CUSTOMER APP      ADMIN APP     INVENTORY APP     RIDER APP
   Flutter           React web     React web         future, separate
   apps/customer     apps/admin    apps/inventory    application
                                   (this phase)
```

- **Customer app:** separate application; unchanged in this phase.
- **Admin app:** separate application (Products, Categories, Promotions);
  unchanged. It has no Inventory navigation.
- **Inventory app:** new, `apps/inventory`. React 18 + Vite 5 + TypeScript
  + react-router, plain CSS; the same stack and conventions as Admin. It runs
  on its own port (5174) with its own session.
- **Rider app:** a future separate application. Nothing rider-related is in
  Inventory.

**No second backend, database or product copy.** Inventory reads products
that Admin created, through the Phase 0 products-first stock endpoint.

**Shared code: a deliberate non-extraction.** Inventory has its own small
API client (single `apiRequest`, token store, single-flight refresh). It
follows the same architecture as Admin's but is not copied from it:
- tokens live under `blynk.inventory.*`, so each app keeps its own session;
- it adds a session-ended signal and query-string building;
- it has no uploads.

A shared package would have meant restructuring the Admin app, which this
phase must not touch; for about 150 lines that isn't worth it. It is worth
revisiting when the Rider app arrives.

The only backend change is **configuration**: `http://localhost:5174` was
added to `CORS_ORIGINS` in the API's `.env` and `.env.example`.

## 2. Screens (IMPLEMENTED, TESTED, LIVE VERIFIED)

```
BLYNK | INVENTORY
  Overview
  STOCK      Inventory · Ledger
  SOURCING   Sourcing queue · Suppliers
```

A test pins the navigation to exactly these five links. It also checks that
no Products, Categories, Promotions, Riders, Customers or Delivery entries
appear.

| Screen | What it shows | Endpoint(s) |
|---|---|---|
| Overview | **Needs stock**: tracked products low or out of stock, worst first, with "orderable but out of stock" leading. **Waiting to be sourced**: open orders with pending items. **Latest stock movements**: last 8 ledger entries. No KPI tiles. | `GET /admin/inventory?low_stock_only=true`, `/admin/orders` + `/admin/orders/:id/sourcing`, `/admin/inventory/adjustments?limit=8` |
| Inventory | Every catalog product: tracking, stock state, Admin's customer state (read-only), last update. Search (name/SKU), All / Tracked / Untracked / Low & out, include inactive. Filters live in the URL. `/` focuses search; ↑/↓ move between rows, Enter opens the product. | `GET /admin/inventory` |
| Product panel | Big on-hand figure, reserved, available and low-at; customer state; tracking; ADMIN-only **Adjust stock** and **Start/Stop tracking**; last ledger entries with a link to the full ledger | `GET /admin/inventory/:id`, `PATCH …/mode`, `POST …/adjust` |
| Ledger | When, product, type, change (+/−), on hand before → after, recorded by, note. Filters: product, type, from/to date. Pagination. **Order is exactly the backend's.** | `GET /admin/inventory/adjustments` |
| Sourcing queue | One table grouped by order, oldest first: order number, status, placed time and progress; per item: product, quantity, stock, estimate, status, **Source** and **Mark unavailable** | `GET /admin/orders?status=PLACED` and `?status=ITEM_UNAVAILABLE`, `GET /admin/orders/:id/sourcing`, `POST …/source`, `POST …/resolve-item` |
| Suppliers | Name/code, contact, address, status; Active / All. ADMIN: add, edit, deactivate, reactivate (no delete; the backend has none) | `GET/POST /admin/suppliers`, `PATCH /admin/suppliers/:id` |

**Every screen handles:**
- **loading:** skeleton rows or a spinner;
- **empty:** a sentence that says what empty means, e.g. "No tracked product is low or out of stock.";
- **error:** the API's own message plus a retry, never a raw exception;
- **unauthorized:** back to sign-in with "Your session has ended";
- **forbidden:** "No access";
- **success:** a toast naming what changed.

## 3. Authentication (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **Existing Blynk OTP only.** Sign-in uses `POST /auth/otp/request` then `/auth/otp/verify`; there is no new mechanism.
- **Role gate.** Only **ADMIN** and **PACKING_STAFF** get a session. CUSTOMER and RIDER are signed straight back out: "This account does not have access to Blynk Inventory". The form returns to the phone step because the code is already spent.
- **Session renewal.** Access tokens are renewed through `/auth/refresh`, one refresh shared by all requests at once (the backend treats a reused refresh token as a replay). If the refresh is refused, the app returns to sign-in.
- **Development "Skip sign-in" (D5):**
  - it runs the normal OTP flow for `VITE_DEV_INVENTORY_PHONE` using the dev code the API returns only outside production;
  - it renders only when `import.meta.env.DEV` is true and the variable is set;
  - the production bundle was grepped: it contains no skip code or variable name;
  - against a production API it refuses: "Skip only works against a development API."

## 4. RBAC (IMPLEMENTED, TESTED, LIVE VERIFIED)

`src/auth/can.ts` mirrors the backend guards in `modules/admin/index.ts`. It
decides which controls are **rendered**; the API refuses everything else
regardless.

| Action | ADMIN | PACKING_STAFF |
|---|---|---|
| View stock, ledger, sourcing, suppliers | ✅ | ✅ |
| Source an item, mark an item unavailable | ✅ | ✅ |
| Adjust stock, change tracking mode | ✅ | — (not rendered; API 403) |
| Add / edit / deactivate suppliers | ✅ | — (read-only list; API 403) |

## 5. Stock behaviour and customer availability (D1)

Every stock state is a **word**, and tracked products also show a **count**.
Colour only reinforces:

| State | Rule | Shown as |
|---|---|---|
| In stock | TRACKED, available > 0, on hand > low mark | `IN STOCK` + `47 units` |
| Low stock | TRACKED, on hand ≤ low mark | `LOW STOCK` + `3 units` (yellow underline) |
| Out of stock | TRACKED, available ≤ 0 | `OUT OF STOCK` + `0 units` (hatched ink) |
| Untracked | UNTRACKED or no inventory row | `Sourced on order`, no number, so it never reads as "empty" |

**Customer state is Admin's and read-only here.**
- Active and available together read "Orderable"; anything else reads out "Inactive" / "Unavailable".
- A tracked product with no stock that Admin still has active and available is flagged **ORDERABLE BUT OUT OF STOCK**, and the Overview puts it first.

This is D1: stock does not drive customer availability, checkout reservation
is **not** implemented, and Inventory never changes `is_available`.

**Admin → Inventory → Customer (live verified):**
1. A product created in the Admin UI appears in Inventory as `UNTRACKED / Sourced on order / Never counted`, with no inventory row created.
2. The customer catalog lists it at the calculated price with no stock, cost or supplier fields.

## 6. Adjustments (D3) (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **Types:** Restock (+), Damage write-off (−), Audit correction (the operator enters the counted figure and the app derives ±).
- **Tracked products only:** untracked products get no Adjust button, and the backend answers `409 PRODUCT_NOT_TRACKED` anyway.
- **Checked in the form before any request:**
  - whole numbers only;
  - a restock or write-off is at least 1;
  - an audit count must differ from what's on hand;
  - the result may not go below 0 or below reserved;
  - a reason is required (it is kept in the ledger).

  A live before → after preview is shown ("On hand 0 → 10 (+10)").
- **Backend is authoritative:** backend refusals are shown in operator wording.
- **One request per click:** a ref guard means a double click sends one request (tested).

## 7. Ledger (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **Contents:** manual adjustments plus the `ORDER_FULFILLMENT` entries sourcing writes for tracked stock, each with who recorded it.
- **Order:** the backend's deterministic order; the client never re-sorts.
- **Filters and pages:** product, type and a local-day date range (converted to the instant range the API filters on); 50 per page.

## 8. Sourcing (D2, D4) (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **Queue:**
  - open orders in `PLACED` or `ITEM_UNAVAILABLE` that still have pending items;
  - `ITEM_UNAVAILABLE` is included because resolving one item moves the whole order to that status while its other items may still need buying.
- **No customer PII.** `/admin/orders` returns the recipient's name, phone and address. The resource layer keeps only the id, order number, status and time, so PII never reaches state or the DOM (asserted in tests and live).
- **Source dialog:**
  - it shows the **estimate** (the catalog cost at order time) beside the **actual unit cost** being entered, with the variance;
  - it states that recording the cost "does not change the customer's price, the markup or the catalog cost";
  - it asks for quantity (1..ordered) and an optional note;
  - supplier comes from the **active list only** (D2), and the payload never carries `supplier_name`;
  - for a tracked product it shows the counted stock and refuses more than is counted.
- **Double sourcing:**
  - the backend `409 ITEM_ALREADY_SOURCED` closes the dialog;
  - it shows "…was already sourced by someone else. Showing the latest queue." and refreshes;
  - no generic error appears;
  - verified live with two browser sessions (admin sources, staff on a stale queue tries the same item).
- **Mark unavailable (D4):**
  - it reuses the existing `POST /admin/orders/:id/resolve-item`;
  - the confirmation spells out the consequences: the item is removed, the total drops by the item's subtotal, and the customer is notified;
  - it is offered on PENDING items only, and from the source dialog when tracked stock is insufficient.

## 9. Suppliers (IMPLEMENTED, TESTED, LIVE VERIFIED)

- **Staff:** read-only list.
- **Admin:** add, edit, deactivate and reactivate, each with a confirmation.
- **Duplicate code:** `409 SUPPLIER_CODE_TAKEN` appears next to the Code field.
- **Blank fields are not sent:** the API can't clear a field, and an empty code would collide with the unique index. So editing can't blank a field (see §12).

## 10. Tests

| Suite | Result |
|---|---|
| Inventory app (`vitest`, 5 files) | **55 passing** · `tsc` clean · production build clean |
| Backend (unchanged this phase) | **330 passing** |
| Live E2E (real Edge, Admin UI + Inventory UI, real API + PostgreSQL) | **31/31 checks**, run twice (before and after the visual refinement) |

**Coverage by area:**
- **Authentication:** ADMIN and staff sign-in; CUSTOMER/RIDER refused with no token kept; wrong code shows the API message; signed-out redirect; refused refresh returns to sign-in; a stored session with the wrong role is dropped; dev skip absent / working / refused without a dev code.
- **Scope:** navigation is exactly the five Inventory links.
- **RBAC:** the full `can()` table for every role.
- **Stock:** each state as word + units; a product with no inventory row; tracked vs untracked; inactive; orderable-but-out flag; search; include-inactive; tracking and low filters; empty, error and 403 states.
- **Adjustments:** restock +, write-off −, audit ± (both directions); decimal, negative and zero refused before any request; below-zero and missing-reason refused; backend `PRODUCT_NOT_TRACKED` shown; double click sends one request; no adjust on untracked; staff sees no controls; start tracking.
- **Ledger:** keeps the backend order; product, type and date filters; pagination; empty filtered state.
- **Sourcing:** queue shows only orders with pending items and never customer PII; payload is exact with no `supplier_name` and active suppliers only; `409 ITEM_ALREADY_SOURCED` shown as a banner; insufficient stock offers Mark unavailable; cost and quantity validated; Mark unavailable goes through resolve-item after confirmation; empty queue.
- **Suppliers:** staff read-only; active/all; admin create sends filled fields only; duplicate code shown inline; name validated; deactivate with no delete.
- **Overview:** orderable-but-out first with an explanation; empty states for all three sections.

**Live E2E steps:**
1. The **Admin UI** creates a product, and the database has no inventory row for it.
2. **Inventory** lists it as untracked / sourced on order / never counted.
3. Start tracking, then restock +10 with the before → after preview; the panel shows 10.
4. The ledger shows "Restock +10 · Nawaz Mansoor".
5. The customer catalog lists it at Rs. 240 with no internal fields; a customer orders 2 of it plus 1 Kotmale.
6. Staff signs in through the real OTP form; the queue shows the order with no PII.
7. Admin sources at Rs. 205 with an active supplier; staff on a stale queue sources the same item and gets the "already sourced" banner, with no generic error.
8. Mark unavailable on the Kotmale line.
9. Database results:
   - actual 205, estimate 200 and price 240 unchanged;
   - exactly one sourcing record;
   - stock 10 → 8 with a `ORDER_FULFILLMENT −2` ledger row;
   - order total 550 (480 + 70 delivery);
   - an `ITEM_UNAVAILABLE` notification queued;
   - the customer order API shows no costs.
10. Supplier created; the duplicate code is shown inline and not created; the supplier is deactivated.
11. Staff sees no adjust or tracking controls and a read-only supplier list.

**Test data:** the E2E harness recorded the baseline and deleted exactly what
it created in a `finally` block (order and its notifications, the inventory
row, the product, the supplier). Both runs ended at the brief's baseline:
- 5 products;
- 4 active suppliers;
- Munchee TRACKED at 47;
- the "Fresh Dairy, Every Morning" promotion live;
- earlier test orders and addresses untouched.

## 11. Visual design and audit

**Direction ("the ledger").**
- **Taste skill:** not installed; `ui-ux-pro-max` was used, keeping its density, motion and accessibility guidance and rejecting its generic SaaS palette.
- **Type and numbers:** Catamaran for text, JetBrains Mono with tabular figures for every quantity, cost, SKU and order number.
- **Tables:** 2 px ink top rule, sticky headers, hairline rows.
- **Colour:** Blynk Yellow for actions, selection and the active navigation rule only; Blynk Green only for in stock and positive changes.
- **Radius:** 4 px throughout.
- **Motion:** 150–200 ms, removed under `prefers-reduced-motion`.
- **Accessibility:**
  - a skip link;
  - visible focus rings;
  - keyboard-navigable rows;
  - focus-trapped dialogs that close on Escape and return focus;
  - field labels that name only the control, with hints and errors linked by `aria-describedby`.

**"Audit this website for generic AI design patterns"** was run on
screenshots of every screen at desktop, laptop and tablet widths. Findings
and fixes (visual layer only; all 55 tests and the 31 live checks passed
unchanged afterwards):

| # | Problem found | Fix |
|---|---|---|
| 1 | Stock table collapsed when the product panel opened: 5-line product names, SKUs broken mid-code, the count shown twice (Stock and On hand) | Product column gets a minimum width, SKUs never wrap, Category/Updated step aside while the panel is open, the duplicate On hand column is removed and the count in the stock cell is enlarged |
| 2 | Sourcing queue repeated one boxed table per order, each with its own header row | One continuous table; each order is a labelled row group with a header row |
| 3 | Overview left half the page empty when nothing needed stock, and squeezed the ledger into a narrow column | Two short lists side by side, the ledger as a full-width table |
| 4 | "● Active ● Available" repeated on every row, hiding the exceptions | The normal case reads "Orderable"; only exceptions spell out Inactive/Unavailable |
| 5 | Monospace used for words ("1 to source") | Mono kept for numbers and codes only |
| 6 | Ledger balance broke across two lines ("10 →" above "8") | Inline muted span; a block-level class on a table cell in the Overview was also fixed |
| 7 | Tablet header was a tall dark band (the grid row stretched) | Brand inline, grid rows sized explicitly: one slim band |

## 12. Limitations

- **Resolve-item backend guards: fixed in Phase 1.5.** `resolve-item` now:
  - refuses an item that is not on the order in the URL (`404 ORDER_ITEM_NOT_FOUND`, the same answer as a missing item);
  - refuses a sourced or packed item (`409 ITEM_ALREADY_SOURCED`) and an already-resolved item (`409 ITEM_ALREADY_RESOLVED`);
  - refuses a cancelled or delivered order (`400 ORDER_NOT_IN_SOURCING_STATE`);
  - validates ids and item status (400, not 500);
  - locks the item row then the order row, so concurrent attempts resolve once.

  Inventory shows the new conflicts as "already resolved by someone else" and refreshes the queue.
- **Supplier fields can't be cleared** through the API (the update schema
  has no nullable fields), so the form keeps blank fields unchanged.
- **The queue is N+1**, one sourcing request per open order. That's fine at
  current volume (3 open orders); a batched endpoint would help at scale.
- **The queue and stock lists read at most 100 rows** per call (the API
  maximum). There is no pagination on the queue yet.
- **"Recent sourcing" isn't on the Overview.** There is no endpoint for
  sourcing records across orders, so the Overview shows ledger movements
  and the open queue instead of inventing it.
- **Low-stock threshold can't be edited:** there is no endpoint (G3 in the
  plan, deferred). The default is 5.
- **Admin form accessibility (observed, not changed).** Admin's `Field`
  wraps the control inside `<label>`, so a select's accessible name includes
  its chosen option. Inventory's `Field` does not have this problem.
- **Live E2E harness not in the repo.** It lives in a scratch directory
  (Playwright + real Edge) because it needs the running servers and spends
  real OTP codes (3 per phone per hour). The repeatable coverage is the 55
  component tests and the backend's `inventory-app-contracts.test.ts`.
- **Narrow phone widths are usable but not optimised**, by design. Tables
  scroll horizontally; the sourcing form fits a phone width.

STATUS: INVENTORY APP FOUNDATION COMPLETE AND VERIFIED

NEXT: INVENTORY OPERATIONAL WORKFLOWS / RIDER APP — SEPARATE APPLICATION
