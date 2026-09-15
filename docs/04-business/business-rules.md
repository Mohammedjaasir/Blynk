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
