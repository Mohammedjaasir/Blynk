# Blynk Confirmed Business Rules

**Status:** Canonical Business Rules Specification  
**Version:** Phase 1 Launch (Dharga Town Hub)  

---

## 1. Geographic & Fulfillment Scope
- **Launch Market**: Dharga Town, Sri Lanka.
- **Store Network**: 1 centrally located physical dark store hub (`DHARGA-01`) at coordinates `(6.438200, 80.027400)`.
- **Delivery Service Radius**: Exactly 4.00 km straight-line geodesic distance from the dark store hub. Addresses beyond 4.00 km are rejected with HTTP 422.
- **Future Expansion**: Designed to support Beruwala and additional dark stores without redesigning schemas or orders.

---

## 2. Economics, Pricing & Fees
- **Default Product Markup**: 20.00% markup over base wholesale purchase cost (`system_configurations.default_markup`).
- **Custom Markup Override**: Individual products may override the default markup percentage (`products.custom_markup_percent`).
- **Authoritative Price Formula**:
  $$\text{Selling Price} = \text{Purchase Cost} \times \left(1 + \frac{\text{Effective Markup \%}}{100}\right)$$
- **Price Immutability**: Line items stamp selling price, estimated catalog cost, and applied markup into `order_items` at placement.
- **Dual Procurement Cost**: Actual market sourcing costs are recorded into `order_items.actual_unit_cost` at packing time without altering customer selling price.
- **Delivery Fee**: Flat 70.00 LKR delivery fee (`system_configurations.delivery_fee`), snapshotted into `orders.delivery_fee`.
- **Minimum Order Requirement**: None. Orders of any amount are accepted.

---

## 3. Operating Hours & Ordering Window
- **Customer Ordering Hours**: 24/7 (orders can be placed at any time).
- **Delivery Operating Window**: 8:00 AM – 9:00 PM (`Asia/Colombo` time).
- **After-Hours Ordering**: Orders placed outside the delivery operating window are accepted and queued for delivery starting at 8:00 AM the next morning (`orders.scheduled_for`).

---

## 4. Payment & Settlement
- **Phase 1 Method**: Strictly Cash on Delivery (COD). No online card/wallet payments in Phase 1.
- **Settlement Progression**:
  - `orders.payment_status = 'PENDING'` at placement.
  - `orders.payment_status = 'PAID'` upon rider confirming cash handover at the customer doorstep.
- **Future Payments**: Database and API provisioned for future online card/wallet payments (Phase 3).

---

## 5. Order Lifecycle & Cancellation
- **Canonical Lifecycle**:
  $$\text{PLACED} \longrightarrow \text{PACKED} \longrightarrow \text{OUT\_FOR\_DELIVERY} \longrightarrow \text{DELIVERED}$$
- **Intermediate States**: No `CONFIRMED` state in Phase 1.
- **Exception States**: `CANCELLED`, `FAILED`, `CUSTOMER_UNAVAILABLE`, `ITEM_UNAVAILABLE`.
- **Customer Cancellation Window**: Permitted self-service via mobile app only before the order moves to `OUT_FOR_DELIVERY`. Cancellation after dispatch is strictly blocked.
- **Out-of-Stock Item Policy**: If an item is unavailable at local markets during sourcing, packing staff flags the item, contacts the customer, and adjusts totals before dispatch.

---

## 6. Sourcing & Inventory
- **Phase 1 Inventory Model**: On-demand sourcing/purchasing from local merchants upon customer order placement (untracked dark-store inventory).
- **Phase 2+ Inventory Model**: Transition to stocked dark-store warehouse inventory with tracked bin-level counts.

### 6.1 When stock changes (implemented 2026-09-19; inventory stock-integrity plan)
Each product is `UNTRACKED` (bought at market for each order; the count is never read) or `TRACKED` (counted stock on the dark-store shelf), switched by an admin. Only a `TRACKED` count moves. Every movement is one row in the append-only ledger (`inventory_adjustments`), with the count before and after, who did it and, for order movements, the order.

| Event | Tracked stock | Ledger type | Why |
|---|---|---|---|
| Customer places an order | **no change** | – | No reservation, no checkout stock check (Inventory D1). Availability to customers is Admin's `is_available`. |
| Staff source an item (Inventory) | **− units sourced** | `ORDER_FULFILLMENT` | The units physically leave the counted shelf into this order's bag. Refused (409) if the count is short. |
| Pack, assign, hand over, pickup, arrive | no change | – | The units are already in the bag. |
| Delivered (rider COD or admin) | no change | – | Taken once, at sourcing; delivery never deducts again. |
| Failed / customer unavailable | no change | – | The bag comes back to the store but still belongs to the order. |
| Re-stage (FAILED → PACKED) | no change | – | Same bag, replacement rider; its items stay PACKED and cannot be sourced (taken) again. |
| **Order cancelled** (customer: PLACED/PACKED; admin: PLACED/ITEM_UNAVAILABLE/PACKED) | **+ what this order took** | `ORDER_CANCELLATION_RESTORE` | The bag is unpacked and the units go back on the shelf, in the same transaction as the cancellation. The amount is this order's own ledger net, so it is exact and can never be returned twice. It comes back even if tracking was switched off since; nothing comes back for items sourced while untracked. |
| Abandoning a failed order | + what it took | `ORDER_CANCELLATION_RESTORE` | Re-stage, then cancel (both existing transitions). |
| Admin restock / write-off / count | ± entered | `PURCHASE_RESTOCK` (+), `DAMAGE_WRITE_OFF` (−), `INVENTORY_AUDIT_ADJUSTMENT` (±) | Tracked products only; never below zero. |

- **Cancellation after pickup** is impossible for anyone, so stock never needs returning from the road.
- **Partial sourcing**: sourcing fewer units than ordered takes only those units, but the customer is still billed for the full ordered quantity (known limitation; shortfalls should be marked unavailable instead).
- **Substitution**: there is no "add substitute item" step yet. A `SUBSTITUTED` line keeps its original product, so its stock and cost follow the original product. A substitute of a different tracked product cannot be represented and is therefore not counted (known limitation).
- `ORDER_RESERVATION` exists in the schema but is not used: there is no reservation in this model.

---

## 7. Logistics & Rider Fleet
- **Fleet Size**: 1–2 riders initially (motorcycles).
- **Dispatch Model**: Manual rider assignment by the dark store manager.
- **Assignment Guard**: Only one active delivery assignment permitted per order (`uq_deliveries_active_assignment`). If a delivery attempt fails or is rejected, a replacement rider can be assigned immediately.

---

## 8. Communications & Notifications
- **Channels**: SMS (NotifyLK) and WhatsApp Cloud API.
- **Decoupled Outbox**: Third-party SMS/WhatsApp failures do not block or roll back order checkout.

---

## 9. Platform Strategy & Client Channels
- **Customer Android**: Native Android mobile application (Flutter client in `apps/customer/`).
- **Customer iOS**: Responsive Web Application / Progressive Web App (PWA) fallback for Safari; native iOS App Store release pursued in parallel.
- **Platform Agnostic**: Backend exposes a unified REST API (`/api/v1`) serving all clients without platform-specific business logic bifurcation.
