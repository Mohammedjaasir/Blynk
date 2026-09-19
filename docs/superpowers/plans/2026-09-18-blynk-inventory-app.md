# Blynk Inventory App — Requirements & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: AWAITING APPROVAL — no implementation code has been written.** Section G lists five decisions that change the backend work; they must be answered before Phase 0 starts.

**Goal:** A separate web application for Blynk's stock, sourcing and supplier operations, running on the existing Blynk backend and database.

**Architecture:** New `apps/inventory` (React 18 + Vite 5 + TypeScript, plain CSS, react-router — the same stack as `apps/admin`, as a separate app with its own client and session). It calls the existing `/api/v1/admin/inventory*`, `/admin/suppliers*`, `/admin/orders/:id/sourcing` and `/admin/orders/:id/items/:itemId/source` endpoints, plus a small number of backend additions listed in §G. One backend, one PostgreSQL database, no product copies.

**Tech Stack:** React 18, Vite 5, TypeScript, react-router 6, Vitest + Testing Library (frontend); Node/TypeScript, Express, Kysely, zod, Vitest against real PostgreSQL (backend).

**Evidence base:** `backend/api/src/modules/inventory/*`, `backend/api/src/modules/admin/index.ts` (route guards), `backend/api/src/modules/orders/*`, migrations `001` and `003`, `docs/02-architecture/blynk_architecture.md` §12, `docs/04-business/business-rules.md` §6, `docs/05-implementation/implementation-status.md` Stage 6, and a read-only snapshot of the dev database (2026-09-18).

## Global Constraints

- Inventory is a separate application. Nothing is added to the Customer app, the Admin app or a Rider app. Admin navigation is not touched.
- One backend, one database. No second inventory store, no copied product records, no microservices/queues/Kubernetes.
- Admin owns Products, Categories, Promotions. Inventory owns stock, sourcing, suppliers and adjustments. Inventory never edits product name, price, cost, markup, category or `is_available`.
- Backend authorization is authoritative; frontend role checks are UX only.
- Customer APIs never expose supplier, `purchase_cost`, `estimated_unit_cost`, `actual_unit_cost`, adjustment history or sourcing details.
- Sourcing must never change `estimated_unit_cost`, `markup_percentage_applied`, `unit_selling_price`, product `purchase_cost` or customer totals.
- Colours: Blynk Yellow `#FFE141` primary action; Blynk Green `#0C831F` for positive/success only; never green-dominant; no coral/red brand colour.
- No fake data, no invented APIs or business rules. Anything missing is listed as a gap.
- Status vocabulary in docs: IMPLEMENTED / TESTED / MANUALLY VERIFIED / UNVERIFIED.

---

## A. Requirements (grounded in the current backend)

### A1. What the backend actually does today

**Tracking mode lives on `inventory`, one row per (dark store, product).** Enum `UNTRACKED | TRACKED`, default `UNTRACKED`. There is one dark store (`DHARGA-01`, id `018dc3f0-…8821`), and every inventory endpoint falls back to it when `dark_store_id` is omitted.

| Mode | Meaning in the code | Evidence |
|---|---|---|
| **UNTRACKED** | Phase 1 model: the item is bought at a local market *after* a customer orders it. Quantities are not consulted anywhere. Sourcing records cost but leaves stock alone. | `sourceOrderItemAtomic` only touches `inventory` when `tracking_mode === 'TRACKED'`; PRD §"Stock Tracking" |
| **TRACKED** | Phase 2 model: physical stock held at the dark store. `quantity_on_hand` is decremented when an order item is **sourced**; manual adjustments move it up or down. | same function, step 6; `adjustStockAtomic` |

**Quantities.** `quantity_on_hand ≥ 0`, `quantity_reserved ≥ 0`, and `quantity_on_hand ≥ quantity_reserved` are enforced by database constraints. `quantity_available = on_hand − reserved` is computed in the repository. `low_stock_threshold` defaults to 5; `is_low_stock = TRACKED && on_hand ≤ threshold`.

**Nothing writes `quantity_reserved`.** No code path reserves at checkout or restores on cancellation. The `ORDER_RESERVATION` and `ORDER_CANCELLATION_RESTORE` adjustment types exist in the enum but are never emitted. The Phase 2 reservation flow in `blynk_architecture.md` §12 is **designed but not implemented**.

**Stock increases** happen only through `POST /admin/inventory/:productId/adjust` with a positive `quantity_delta`.

**Stock decreases** happen through:
1. a manual adjustment with a negative delta; or
2. sourcing a TRACKED order item. This subtracts the sourced quantity and writes an `ORDER_FULFILLMENT` ledger row. If on-hand stock is insufficient, the API returns `409 INSUFFICIENT_TRACKED_INVENTORY`.

**Adjustments** run in one transaction:
1. lock the row, or create it (**as TRACKED**) if it doesn't exist;
2. reject a result below 0 (`NEGATIVE_INVENTORY_PROHIBITED`) or below `quantity_reserved` (`INSUFFICIENT_AVAILABLE_INVENTORY`);
3. update the quantity;
4. append an immutable `inventory_adjustments` row with the previous quantity, new quantity, type, notes, `created_by_user_id` and an optional `reference_order_id`.

`quantity_delta` must be a non-zero integer, and notes are limited to 500 characters.

**Sourcing is per order item, not per product.** `POST /admin/orders/:id/items/:itemId/source` works like this:
- **Checks:**
  - the item must belong to the order (IDOR guard);
  - the item must not be `UNAVAILABLE`;
  - the quantity must be between 1 and the ordered quantity;
  - the order must not be `CANCELLED` or `DELIVERED`.
- **Supplier:** either `supplier_id`, which must be active, or `supplier_name`. A `supplier_name` is looked up by exact name, and **a new supplier is created if none matches**.
- **Cost:**
  - `order_items.actual_unit_cost` is set, rounded to 2 decimal places, and `item_status` becomes `SOURCED`;
  - an immutable `sourcing_records` row snapshots the estimated and actual cost;
  - `estimated_unit_cost`, `unit_selling_price`, the markup and product `purchase_cost` are **not** touched.
- **Tracked products:** stock is also decremented, as described above.

**Actual unit cost** stays NULL until the item is sourced, and stays NULL when an item is resolved as unavailable (`implementation-status.md` Stage 6).

**Suppliers:** create, list (`active_only` defaults to true), get and update. There is **no delete**; retiring a supplier means `PATCH { is_active: false }`. `code` is UNIQUE, and a duplicate code surfaces as a database error.

**Unavailable items** (`POST /admin/orders/:id/resolve-item`, `PATCH /admin/orders/:id/items/:itemId`) mark an item `UNAVAILABLE`, `SUBSTITUTED` or `FULFILLED`, recalculate totals and COD, and enqueue a customer notification.

### A2. Inventory state → customer availability (current behaviour, documented, not changed)

```
Admin: products.is_active, products.is_available  ──►  customer catalog & checkout
Inventory: inventory.quantity_*                    ──►  (nothing customer-facing)
```

- The customer catalog shows products where `is_active = true`. Checkout rejects a product unless `is_active && is_available` (`order.service.ts:102`).
- **Stock level has no effect on customer availability.** When a TRACKED product reaches 0:
  - it stays orderable while Admin's `is_available` is true;
  - sourcing that order then fails with `409 INSUFFICIENT_TRACKED_INVENTORY`;
  - staff resolve it through the unavailable-item flow: the item is removed, totals recalculated, the customer notified.
- This is the Phase 1 design (`implementation-status.md`: "product availability is governed by `products.is_available`"). Automatic stock-driven availability is Phase 2 and is **not** part of this plan unless you decide otherwise (Decision D1).

### A3. Functional requirements

| # | Requirement | Source |
|---|---|---|
| R1 | Sign in with the existing OTP flow; only `ADMIN` and `PACKING_STAFF` get a session in this app | existing auth + route guards |
| R2 | Stock list: every **active catalog product** with SKU, category, tracking mode, on hand, reserved, available, low-stock flag, customer availability (read-only), last update | `GET /admin/inventory` + gap G1 |
| R3 | Filters: tracking mode, low stock only, search by name or SKU | existing `tracking_mode`, `low_stock_only` + gap G1 (search) |
| R4 | Product stock detail with the last 50 ledger entries | `GET /admin/inventory/:productId` |
| R5 | Switch tracking mode (ADMIN), with confirmation explaining the consequence | `PATCH /admin/inventory/:productId/mode` |
| R6 | Record an adjustment (ADMIN): restock / damage write-off / audit correction, quantity and reason; one submission at a time | `POST /admin/inventory/:productId/adjust` + decision D3 |
| R7 | Ledger: adjustment history across products, filterable by product, type and date | **gap G2** |
| R8 | Sourcing queue: open orders with items still `PENDING` | `GET /admin/packing-queue` + `GET /admin/orders/:id/sourcing` |
| R9 | Source an item: actual unit cost, quantity, supplier, notes; shows the estimate beside it; cannot be submitted twice | `POST …/source` + **gap B1** |
| R10 | Supplier list (active / all), view (ADMIN + STAFF); create, edit, deactivate / reactivate (ADMIN) | supplier endpoints |
| R11 | Overview: only facts derivable from these APIs (see §C) | — |
| R12 | Never display customer delivery PII in inventory screens, even though `/admin/orders*` returns it | minimisation |

---

## B. User roles (verified against `modules/admin/index.ts`)

| Capability | Endpoint | ADMIN | PACKING_STAFF | CUSTOMER / RIDER |
|---|---|---|---|---|
| List stock | `GET /admin/inventory` | ✅ | ✅ | 403 |
| Product stock + history | `GET /admin/inventory/:productId` | ✅ | ✅ | 403 |
| Change tracking mode | `PATCH /admin/inventory/:productId/mode` | ✅ | 403 | 403 |
| Adjust stock | `POST /admin/inventory/:productId/adjust` | ✅ | 403 | 403 |
| List / view suppliers | `GET /admin/suppliers[/:id]` | ✅ | ✅ | 403 |
| Create / edit / deactivate supplier | `POST`, `PATCH /admin/suppliers` | ✅ | 403 | 403 |
| Sourcing queue (placed orders) | `GET /admin/packing-queue` | ✅ | ✅ | 403 |
| Order sourcing detail | `GET /admin/orders/:id/sourcing` | ✅ | ✅ | 403 |
| Source an item | `POST /admin/orders/:id/items/:itemId/source` | ✅ | ✅ | 403 |
| Resolve an unavailable item | `POST /admin/orders/:id/resolve-item` | ✅ | ✅ | 403 |

This matches your brief (adjust ADMIN-only; sourcing ADMIN + STAFF; supplier CRUD ADMIN-only) with two findings:

- **Suppliers can be created through sourcing.** `sourceOrderItem` with `supplier_name` creates a supplier on the fly, and PACKING_STAFF may call it. So STAFF can create suppliers indirectly, although supplier CRUD is ADMIN-only. See Decision D2.
- **Cost prices reach PACKING_STAFF.** `GET /admin/inventory/:productId` returns `purchase_cost`, and sourcing responses carry `estimated_unit_cost`. Both are internal, but both roles are internal staff, so this is not a customer leak. The Inventory UI will show the estimate only where it helps sourcing, and will not show `purchase_cost`.

Seeded accounts for testing: ADMIN `+94775551122`, PACKING_STAFF `+94774443322`.

---

## C. Information architecture

Validated against the workflows above. Adjustments are an *action on a stock row* plus a *ledger*, so they split naturally.

```
BLYNK ▌INVENTORY
  Overview
  STOCK
    Stock levels        list + product panel (detail, history, mode, adjust)
    Ledger              all adjustments, newest first            (needs G2)
  SOURCING
    Sourcing queue      open orders → items → source / unavailable
    Suppliers           list, view; add / edit / deactivate (ADMIN)
```

- **Role shaping:** PACKING_STAFF sees every screen, but Adjust, Change mode and supplier add/edit are **not rendered** for them. Controls aren't just disabled; the API refuses these actions regardless.
- **Overview:** no KPI tiles; each list below is backed by an endpoint.
  1. *Needs stock:* TRACKED products at 0 available, then low stock (`low_stock_only=true`).
  2. *Orderable but empty:* TRACKED products with `is_available = true` and 0 available. Customers can still order these, and sourcing will fail (needs G1 fields). This is the most useful warning the current backend can support.
  3. *Waiting to be sourced:* open orders with PENDING items (packing queue + sourcing details).
  4. *Recent ledger:* last 10 adjustments (needs G2).
- **Out of scope:** customers, promotions, catalog editing, riders, deliveries, order status changes (PLACED → PACKED etc.) and order totals.

---

## D. Workflows

**D-1 Restock a tracked product (ADMIN)**
1. Stock levels → search the product → open its panel → **Adjust**.
2. Choose type *Restock* (+) and enter the quantity (whole number > 0) and a reason (required in the UI).
3. The review line reads "On hand 12 → 36"; confirm.
4. `POST …/adjust`. The panel updates from the response and the ledger row appears.

**D-2 Write off / audit correction (ADMIN)**
- Same flow. *Damage write-off* is always negative. *Audit correction* is either sign, and the UI takes a counted figure and derives the delta.
- The UI refuses a result below 0 or below reserved, and the API is the backstop (`NEGATIVE_INVENTORY_PROHIBITED`, `INSUFFICIENT_AVAILABLE_INVENTORY`).

**D-3 Start tracking a product (ADMIN)**
- UNTRACKED → TRACKED creates or updates the row with quantity 0. The confirmation says: "Stock will start at 0. Record a restock before orders are sourced, or sourcing will fail."
- TRACKED → UNTRACKED keeps the quantities, which are then ignored. The confirmation says so.

**D-4 Source an order item (ADMIN or STAFF)**
1. Sourcing queue → order → item.
2. The panel shows the product, quantity ordered, tracking mode, available stock (if tracked) and the estimated unit cost.
3. Enter the actual unit cost, the quantity (defaults to the ordered quantity), a supplier from the active list, and optional notes.
4. Submit once. The button locks and the item becomes **SOURCED**.
5. For a TRACKED product, the new on-hand figure is shown. On a 409 insufficient-stock error, offer "Mark unavailable" (Decision D4).

**D-5 Item cannot be sourced (ADMIN or STAFF, Decision D4)**
- "Mark unavailable" leads to a confirmation stating that the customer is notified and the order total is reduced, then calls `POST /admin/orders/:id/resolve-item` with `{ item_id, item_status: 'UNAVAILABLE' }`.

**D-6 Supplier lifecycle (ADMIN)**
- Add (name required; code optional and unique) → edit → deactivate or reactivate (`is_active`). No delete, because the backend has none.

---

## E. API mapping

| Screen / action | Endpoint (existing unless marked) | Notes |
|---|---|---|
| Sign in | `POST /auth/otp/request`, `/auth/otp/verify`, `GET /auth/me`, `POST /auth/refresh`, `/auth/logout` | role must be ADMIN or PACKING_STAFF |
| Stock list | `GET /admin/inventory?tracking_mode&low_stock_only&page&limit` | + G1: products without a row, `is_available`, `is_active`, `search` |
| Product panel | `GET /admin/inventory/:productId` | returns the UNTRACKED default when no row exists |
| Change mode | `PATCH /admin/inventory/:productId/mode` | ADMIN |
| Adjust | `POST /admin/inventory/:productId/adjust` | ADMIN; D3 narrows accepted types |
| Ledger | **new** `GET /admin/inventory/adjustments` | G2 |
| Sourcing queue | `GET /admin/packing-queue` → `GET /admin/orders/:id/sourcing` per order | PLACED orders only; N+1 acceptable at current volume (3 open orders) |
| Source item | `POST /admin/orders/:id/items/:itemId/source` | + B1 guard |
| Mark unavailable | `POST /admin/orders/:id/resolve-item` | Decision D4 |
| Suppliers | `GET/POST /admin/suppliers`, `GET/PATCH /admin/suppliers/:id` | `active_only=false` for all |

## F. Database mapping

| Table | Used for | Change needed? |
|---|---|---|
| `products` | name, SKU, unit, category, `is_active`, `is_available` (read-only, owned by Admin) | none |
| `inventory` | tracking mode, on hand, reserved, threshold, `updated_at` | none |
| `inventory_adjustments` | immutable ledger | none (G2 is a read endpoint; join `users.full_name` for the actor) |
| `sourcing_records` | immutable sourcing audit | none |
| `order_items` | `actual_unit_cost`, `item_status`, snapshots | none |
| `orders` | sourcing context (number, status, store) | none; PII columns are not displayed |
| `suppliers` | supplier directory, `is_active` retirement | none |
| `dark_stores` | single store DHARGA-01 | none |

**No schema migration is required** for the recommended scope. The existing schema already supports every requirement; the gaps are in the API layer.

---

## G. Gaps and decisions

### G-table: requirement vs existing API

| Requirement | Existing API | UI possible now? | Backend change needed? |
|---|---|---|---|
| Sign in, role gating | auth + guards | Yes | No |
| Stock list incl. **Admin-created products** | `GET /admin/inventory` inner-joins `inventory`, so a product created in Admin has **no row and is invisible** | Partially | **G1:** list from `products LEFT JOIN inventory`, a row-less product appearing as UNTRACKED/0 (the same default `GET /inventory/:productId` already returns). Also add `is_active`, `is_available` and `search` (name/SKU) |
| Customer availability column | not in the inventory response | No | G1 (read-only fields) |
| Product detail + history | `GET /admin/inventory/:productId` | Yes | No |
| Change tracking mode | `PATCH …/mode` | Yes | No |
| Adjust stock | `POST …/adjust` | Yes | Recommended **D3** |
| Cross-product ledger | none (per-product last 50 only) | No | **G2:** `GET /admin/inventory/adjustments?product_id&type&from&to&page&limit`, ADMIN + STAFF, with product name/SKU and actor name |
| Sourcing queue | packing queue + sourcing detail | Yes | No |
| Prevent double sourcing | **none**: a `SOURCED` item can be sourced again, creating duplicate records and double stock decrement (the code comment says "or already PACKED", but only `UNAVAILABLE` is checked) | UI can lock, but not safely | **B1:** reject when `item_status` is `SOURCED` or `PACKED` → `409 ITEM_ALREADY_SOURCED` |
| Mark item unavailable | `resolve-item` | Yes | No (D4 is a scope decision) |
| Supplier CRUD / deactivate | supplier endpoints | Yes | No; optionally map the duplicate-`code` DB error to `409 SUPPLIER_CODE_TAKEN` (**G4**) so the UI can show it |
| Edit low-stock threshold | none | No | **G3 (optional):** `PATCH /admin/inventory/:productId/threshold` ADMIN; can be deferred |
| Stock-driven customer availability | none (Phase 2 design only) | No | **D1**, not in this plan by default |
| Test data hygiene | backend tests leave inactive suppliers (27 in the dev DB) | — | **G5:** tests clean up the suppliers they create; one-off cleanup of existing test suppliers |

### Decisions needed (recommendation first)

- **D1 Stock and customer availability.**
  - *Recommended:* keep current behaviour. Inventory shows availability read-only and flags "orderable but empty"; Admin keeps `is_available`.
  - *Alternative:* implement the Phase 2 reservation from `blynk_architecture.md` §12 (checkout `SELECT … FOR UPDATE`, reserve, out-of-stock error, restore on cancel). That changes checkout and customer behaviour and deserves its own plan.
- **D2 Supplier creation during sourcing.**
  - *Recommended:* the Inventory UI offers only a picker of active suppliers (no free-text name). The backend keeps accepting `supplier_name`, so no behaviour changes for other clients.
  - *Stricter:* the backend rejects `supplier_name` for non-ADMIN.
- **D3 Manual adjustment types.**
  - *Recommended:* the backend's manual endpoint accepts only `PURCHASE_RESTOCK` (delta > 0), `DAMAGE_WRITE_OFF` (delta < 0) and `INVENTORY_AUDIT_ADJUSTMENT` (either sign), and only on TRACKED rows. Today it also accepts the system types (`ORDER_*`), any sign, and silently changes UNTRACKED rows or creates a TRACKED row.
  - *Minimal:* enforce this in the UI only.
- **D4 "Mark unavailable" in the sourcing screen.**
  - *Recommended:* include it. It is the documented outcome of a failed sourcing (`business-rules.md` §5), it is ADMIN+STAFF, and it is the only item-level order action included. No order status transitions.
- **D5 Dev "Skip sign-in".** *Recommended:* the same dev-only pattern as Admin, with `VITE_DEV_INVENTORY_PHONE`, excluded from production builds.

---

## H. Visual direction ("Taste": `ui-ux-pro-max`, which stands in because the Taste skill is not installed)

Skill output was taken for **density (dial 9), motion (3) and accessibility**. Its palette (slate + green CTA), "SaaS Mobile" style, gradient buttons, glassmorphism, bobbing FAB and pulsing badges were **rejected** as the generic patterns this app must avoid.

**Identity: "the ledger".** Admin is about *what customers see*; Inventory is about *counts and money moving*. Numbers are the hero. Inventory shares the family traits of Admin (ink sidebar, yellow rule, 4 px radius, dot statuses) so staff moving between the two recognise it, but differs where it counts:

- **Typography:** Catamaran (Blynk brand, already used) for UI text. **JetBrains Mono** for SKUs, quantities, deltas, costs and order numbers, with tabular figures so columns align. Scale: 12 / 13 / 14 (body) / 18 (section) / 28 (page title), plus a 40 mono figure for a product's on-hand count in its panel.
- **Layout:** fixed ink sidebar (220 px) and a full-width work area, max content width 1600 px. The stock list and product panel sit side by side on desktop, so the list stays visible while adjusting. No card grids.
- **Spacing:** 4 px base; dense scale 4 / 8 / 12 / 16 / 24 / 32. Row height 40 px with 44 px minimum targets.
- **Colour tokens:**
  - ink `#12151F`, ink-2 `#4A5060`, line `#E6E8EE`, surface `#FFFFFF`, canvas `#F6F7F9`;
  - Blynk Yellow `#FFE141` for primary actions and the active rule only;
  - Blynk Green `#0C831F` for "in stock", success and positive deltas;
  - errors reuse Admin's existing error token, for text only.
- **Tables:**
  - 2 px ink top rule, sticky header, hairline rows;
  - numbers right-aligned in mono;
  - a **delta column** (`+24` green, `−3` ink) and a **running on-hand column** in the ledger;
  - zebra striping off, row hover tint, keyboard-focusable rows (↑/↓ move, Enter opens the panel).
- **Status treatment** (colour is never the only signal; always a word):
  - *In stock:* green dot + number.
  - *Low:* yellow bar under the number plus "Low · 3 left".
  - *Out:* ink "0" with a diagonal-hatch cell plus "Out".
  - *Untracked:* muted "Sourced on order", with no number shown, because a 0 would read as "empty".
  - *Sourcing:* PENDING (hollow dot), SOURCED (green dot), UNAVAILABLE (strike + ink).
- **Motion:** 150–200 ms only; the panel slides in 180 ms; a saved row flashes yellow once for 600 ms; `prefers-reduced-motion` removes both.
- **Visual identity:** a "BLYNK ▌INVENTORY" wordmark with the new logo mark, and a yellow rule under the active nav item. No illustrations, gradients or glass effects.

**Operations UX:**
- `/` focuses search;
- filters persist in the URL, so views can be linked and survive back navigation;
- a skip-to-content link;
- visible focus rings;
- destructive or stock-changing actions show a before → after review line;
- submit buttons lock while in flight;
- every list has loading (skeleton rows), empty (says why) and error (API message) states.

**Responsive:**
- **Desktop ≥ 1280:** list and panel side by side.
- **Laptop 1024–1279:** sidebar narrows to 184 px and the panel overlays the list.
- **Tablet 768–1023:** top nav bar, full-screen panel, tables scroll horizontally with the product column pinned.
- **Below 768:** usable, not optimised. The **sourcing form must work at phone width**, because staff record costs at the market.

---

## I. Implementation plan

Each phase ends with its own passing tests and a commit. The backend phase runs first so the UI is built against real contracts.

### File structure (new unless marked)

```
backend/api/src/modules/inventory/
  inventory.repository.ts   (modify: listInventory LEFT JOIN + search; listAdjustments; B1 guard)
  inventory.schema.ts       (modify: search param; adjustmentsQuerySchema; D3 manual types)
  inventory.service.ts      (modify: D3 sign/mode rules; listAdjustments)
  inventory.controller.ts   (modify: listAdjustments)
backend/api/src/modules/admin/index.ts   (modify: GET /inventory/adjustments registered BEFORE /inventory/:productId)
backend/api/tests/inventory.test.ts      (modify: new cases + supplier cleanup)
backend/api/tests/inventory-app-flow.test.ts   (new: Admin → Inventory → Customer integration)

apps/inventory/
  index.html, package.json, vite.config.ts, tsconfig.json, .env.example, public/favicon.png
  src/main.tsx, src/App.tsx, src/styles.css
  src/api/client.ts         apiRequest, tokenStore (own keys: blynk.inventory.*), single-flight refresh
  src/api/types.ts          StockRow, StockDetail, Adjustment, Supplier, SourcingOrder, SourcingItem
  src/api/resources.ts      stock, ledger, sourcing, suppliers, auth
  src/auth/AuthContext.tsx  allowed roles ADMIN | PACKING_STAFF; exposes role
  src/auth/can.ts           can(role, action) — UX gating table mirroring §B
  src/components/Layout.tsx, ui.tsx (Status, Qty, Delta, ConfirmDialog, EmptyState, Spinner, Toast)
  src/pages/Login.tsx, Overview.tsx, Stock.tsx, StockPanel.tsx, Ledger.tsx,
            SourcingQueue.tsx, SourceItemDialog.tsx, Suppliers.tsx
  src/test/*.test.tsx
```

### Phase 0: Backend gaps (test-first; scope depends on D1–D4)

**Task 0.1 G1: the stock list includes every product**
- Tests (`inventory.test.ts`):
  - a product created through `POST /admin/products` appears in `GET /admin/inventory` as `tracking_mode: 'UNTRACKED'`, `quantity_on_hand: 0`, `inventory_id: null`;
  - the response includes `is_active` and `is_available`;
  - `?search=` matches name and SKU case-insensitively;
  - pagination `total` counts row-less products;
  - `low_stock_only` still returns only TRACKED rows;
  - PACKING_STAFF 200, CUSTOMER 403.
- Implementation: query from `products p LEFT JOIN inventory inv ON inv.product_id = p.id AND inv.dark_store_id = :store`, `COALESCE` the defaults, `WHERE p.is_active` unless `include_inactive=true`. No writes, and no rows are created.

**Task 0.2 G2: ledger endpoint**
- Tests:
  - `GET /admin/inventory/adjustments` returns the newest first, with `product_name`, `product_sku`, `actor_name`, type, delta, previous and new quantity, and notes;
  - filters `product_id`, `type`, `from`, `to`;
  - pagination;
  - ADMIN and STAFF 200, CUSTOMER 403;
  - the route is not captured by `/inventory/:productId` (it must be registered before that route).

**Task 0.3 B1: no double sourcing**
- Tests:
  - sourcing the same item twice → second call `409 ITEM_ALREADY_SOURCED`, exactly one `sourcing_records` row;
  - a TRACKED product's stock is decremented once;
  - `estimated_unit_cost` and `unit_selling_price` are unchanged after sourcing (existing invariant, re-asserted).

**Task 0.4 D3: manual adjustment rules** (if approved)
- Tests:
  - `ORDER_RESERVATION`, `ORDER_FULFILLMENT` or `ORDER_CANCELLATION_RESTORE` via the manual endpoint → 400;
  - `PURCHASE_RESTOCK` with a negative delta → 400;
  - `DAMAGE_WRITE_OFF` with a positive delta → 400;
  - adjusting an UNTRACKED or row-less product → `409 PRODUCT_NOT_TRACKED`;
  - existing negative and reserved guards still hold.
- Sourcing's internal `ORDER_FULFILLMENT` path is unaffected.

**Task 0.5 G4 + G5: supplier hygiene**
- Tests:
  - a duplicate `code` → `409 SUPPLIER_CODE_TAKEN` (not 500);
  - the supplier tests delete what they create in `afterAll`.
- One-off script (`scripts/cleanup-test-suppliers.ts`, dry-run by default) to remove inactive suppliers with no `sourcing_records`. **Run only with your go-ahead.**

**Task 0.6 Customer safety regression**
- Tests: `GET /catalog/products`, `GET /orders` and `GET /orders/:id` as CUSTOMER contain none of the keys `purchase_cost`, `estimated_unit_cost`, `actual_unit_cost`, `supplier`, `supplier_id`, `sourcing_records`, `quantity_on_hand`, `adjustments`, before and after sourcing.

### Phase 1: App foundation
- **Task 1.1:**
  - scaffold `apps/inventory` (port 5174, `VITE_API_BASE_URL`);
  - tokens and base styles from §H, the layout shell and nav from §C, the logo;
  - add `http://localhost:5174` to the backend CORS allow-list in env (config only).
- Tests: the nav renders exactly Overview, Stock levels, Ledger, Sourcing queue, Suppliers; no Products, Categories, Promotions, Riders, Deliveries or Customers links; the production build succeeds.

### Phase 2: Authentication and role gating
- **Task 2.1:** client (single-flight refresh), `AuthContext` accepting ADMIN | PACKING_STAFF, `can.ts`, Login (+ D5 dev skip).
- Tests:
  - ADMIN and PACKING_STAFF sign in; CUSTOMER and RIDER are refused with no token kept;
  - `can('PACKING_STAFF', 'adjust') === false`, matching §B for every action;
  - a 401 refresh is shared by concurrent requests;
  - the production bundle contains no dev-skip strings.

### Phase 3: Stock levels
- **Task 3.1:** stock table (G1 fields), search `/`, filters in the URL, status treatment, keyboard rows.
- **Task 3.2:** product panel (detail, last 50 ledger rows, Change mode for ADMIN with a D-3 confirmation).
- Tests:
  - tracked vs untracked rendering ("Sourced on order", no number shown);
  - low and out states carry words, not only colour;
  - a row-less Admin product is listed;
  - STAFF sees no Change-mode control;
  - the mode change sends `{ tracking_mode }` and refreshes the row.

### Phase 4: Adjustments and ledger
- **Task 4.1:** adjust dialog (type → sign rules, integer > 0, required reason, before → after preview, lock while submitting).
- **Task 4.2:** ledger page (G2) with filters and delta/running columns.
- Tests:
  - 0, decimal, empty and negative-restock inputs are blocked with messages;
  - a result below reserved is blocked client-side and the API message is shown when the server refuses;
  - a double click sends one request;
  - STAFF cannot open Adjust;
  - the ledger renders API rows in order.

### Phase 5: Sourcing
- **Task 5.1:** sourcing queue (packing queue → per-order sourcing detail, PENDING first; no customer PII rendered).
- **Task 5.2:** source-item dialog (actual cost ≥ 0 with 2 decimal places, quantity 1..ordered, active-supplier picker per D2, notes); handle 409 insufficient stock and 409 already sourced; D4 "Mark unavailable" with confirmation.
- Tests:
  - the payload contains only `actual_unit_cost`, `quantity`, `supplier_id` and `notes`;
  - the estimate is shown but not editable;
  - no price or markup field exists;
  - SOURCED items have no Source button;
  - a 409 shows the API message and offers "Mark unavailable" (D4);
  - STAFF can source;
  - the recipient name, phone and address are not in the DOM.

### Phase 6: Suppliers
- **Task 6.1:** list (active / all), view; ADMIN add, edit, deactivate / reactivate with confirmation; no delete.
- Tests:
  - validation (name 2–128 characters, phone ≤ 20);
  - `409` code conflict shown inline;
  - STAFF sees a read-only list;
  - deactivate sends `{ is_active: false }`.

### Phase 7: Overview
- **Task 7.1:** the four lists from §C, each with an empty state that says what "nothing here" means.
- Tests: every figure is traceable to a mocked endpoint response; no list renders when its endpoint fails (an error line instead).

### Phase 8: Integration and customer availability
- **Task 8.1** `inventory-app-flow.test.ts` (real Express + PostgreSQL):
  1. Admin creates *Kotmale Fresh Milk 1L*.
  2. `GET /admin/inventory?search=Kotmale` shows it as UNTRACKED.
  3. ADMIN sets TRACKED and restocks 10.
  4. The customer catalog shows the product with **no stock or cost fields**.
  5. A customer orders 2; STAFF sources it at cost X.
     - on hand is 8;
     - the ledger has `ORDER_FULFILLMENT −2`;
     - `actual_unit_cost` = X;
     - `estimated_unit_cost`, `unit_selling_price` and the customer total are unchanged;
     - customer order responses show no costs.
  6. Stock reaches 0 → the customer can still order (documents A2) → sourcing returns 409 → resolve-item UNAVAILABLE reduces the customer total.
  7. Admin sets `is_available=false` → the customer checkout rejects the product.
  8. Clean up everything created.
- **Task 8.2:** manual browser pass in Edge:
  - sign in as ADMIN, then as STAFF;
  - restock → ledger → source → supplier add/deactivate;
  - desktop, laptop and tablet widths;
  - capture screenshots.

### Phase 9: Generic design audit
- Run exactly: "Audit this website for generic AI design patterns."
- Inspect generic dashboard patterns, repetitive cards, weak hierarchy, whitespace, rounded containers, generic tables, meaningless colour, Blynk identity.
- Record the findings.

### Phase 10: Visual refinement
- Apply the audit fixes without changing functionality; all Phase 0–8 tests stay green.

### Phase 11: Documentation
- `docs/05-implementation/blynk-inventory-app-report.md` (IMPLEMENTED / TESTED / MANUALLY VERIFIED / UNVERIFIED).
- `implementation-status.md` Inventory section.

### Security plan (applies across phases)

- **Authentication:** existing OTP + JWT (15 min access, 30 day rotating refresh with replay revocation). Separate token keys from Admin.
- **RBAC:** every call is guarded server side (§B). The UI hides actions via `can()` but never relies on it. Tests assert 403 for PACKING_STAFF on ADMIN-only routes and for CUSTOMER/RIDER on all routes.
- **IDOR:** sourcing already checks item ∈ order; B1 adds a state check. Product and supplier ids are validated as UUIDs by zod before use.
- **Input validation:** zod on every body and query (integers, non-zero deltas, cost ≥ 0 with 2 decimal places, string lengths); the UI mirrors it.
- **Auditability:**
  - every stock change is an immutable `inventory_adjustments` row with actor, before, after, type, notes and the order reference;
  - every sourcing is an immutable `sourcing_records` row;
  - there is no update or delete endpoint for either ledger.
- **Cost protection:** costs appear only in inventory/sourcing responses (ADMIN/STAFF). The Phase 0.6 regression test pins customer payloads. The UI never shows `purchase_cost`.
- **Supplier data:** contact details are shown only to ADMIN and STAFF; there are no public supplier endpoints.
- **Secrets:** `VITE_*` holds only the API URL and the dev phone (dev builds only).

---

## Self-review

- **Spec coverage (brief §1–22):**
  - §1 → A1
  - §2 → Global Constraints, C
  - §3 → A1, D
  - §4 → B
  - §5 → C
  - §6 → C Overview
  - §7 → R2, Phase 3
  - §8 → D-1/D-2, Phase 4
  - §9 → D-4, Phase 5
  - §10 → D-6, Phase 6
  - §11 → G1, Phase 8
  - §12 → A2, Phase 0.6
  - §13 → A2
  - §14 → H
  - §15 → H Operations UX
  - §16 → H Responsive
  - §17 → G-table
  - §18 → F
  - §19 → Security plan
  - §20 → phase tests + Phase 8
  - §21 → Phase 9
  - §22 → this document
- **Placeholders:** none. Every gap is named with its endpoint, error code and test.
- **Names used consistently:** G1–G5, B1, D1–D5, `can()`, `ITEM_ALREADY_SOURCED`, `PRODUCT_NOT_TRACKED`, `SUPPLIER_CODE_TAKEN`.
- **Deliberately not in the plan:** code. Per-task TDD steps with code will be expanded once decisions D1–D5 are answered, because they change Phase 0.
