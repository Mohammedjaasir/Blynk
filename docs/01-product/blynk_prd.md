# Blynk Product Requirements Document (PRD)

**Project:** Blynk Quick-Commerce Grocery Platform  
**Launch Scope:** Phase 1 Launch (Dharga Town, Sri Lanka)  
**Document Status:** Canonical Product Specification Baseline  
**Last Updated:** Phase 1 Consistency Audit & Harmonization

---

## 1. Executive Summary & Vision

Blynk is an owned-inventory quick-commerce grocery delivery platform designed specifically for local markets in Sri Lanka, initiating service in Dharga Town. Blynk provides an ultra-reliable, accessible grocery buying experience, delivering fresh essentials, pantry goods, dairy, snacks, and household commodities to customers within a 4 km delivery radius of physical dark store fulfillment hubs.

---

## 2. Harmonized Business Decisions & Audit Log

The following requirements represent confirmed business decisions harmonized across the PRD, Architecture, Database Design, API Architecture, and Business Rules:

| Requirement Area | Confirmed Phase 1 Decision | Future Roadmap (Phase 2 / Phase 3) |
|---|---|---|
| **Payment Method** | **Cash on Delivery (COD) ONLY**. No online card/wallet payments in Phase 1. | Online payment gateway (IPG, cards, wallets) deferred to Phase 3. |
| **Inventory Model** | **On-demand sourcing/purchasing** from local partner merchants upon customer order placement (untracked dark-store inventory). | Stocked physical warehouse dark-store inventory with tracked stock levels (Phase 2). |
| **Order Lifecycle** | **`PLACED → PACKED → OUT_FOR_DELIVERY → DELIVERED`**. No `CONFIRMED` intermediate state. | Algorithmic batch packing and dispatch (Phase 3). |
| **Delivery Fee** | **Flat 70.00 LKR** per order, regardless of cart size or item count. | Dynamic or tiered delivery fees (Phase 3). |
| **Pricing & Markup** | **Default 20.00% markup** over base purchase cost, with per-product override capability. | Promotional discounts, coupons, surge pricing (Phase 2+). |
| **Delivery Radius** | **4.00 km** straight-line geodesic radius from the dark store hub. | Multi-store hub coverage expansion (Beruwala) (Phase 2). |
| **Ordering Window** | **24/7 ordering** accepted. | Continuous 24/7 ordering maintained across all phases. |
| **Delivery Operating Window** | **8:00 AM – 9:00 PM** (`Asia/Colombo`). After-hours orders queued for 8:00 AM delivery. | Extended operating hours as dark-store shifts expand. |
| **Order Cancellation** | **Permitted only before `OUT_FOR_DELIVERY`**. Cancellation is blocked once the rider is dispatched. | Automated cancellation windows with grace periods (Phase 2). |
| **Rider Fleet & Assignment** | **1–2 dedicated riders** initially. **Manual dispatch** by store operations manager. | Automated algorithmic rider matching & dispatch (Phase 3). |
| **Launch Location** | **Dharga Town** single dark store hub (`DHARGA-01`). | Beruwala expansion and multi-dark-store network (Phase 2). |
| **Platform Strategy** | **Native Android customer app** (Flutter) + **iOS responsive Web/PWA fallback**. | Native iOS App Store app pursued in parallel. |

---

## 3. Detailed Operational & Functional Requirements

### 3.1 Geographic & Store Fulfillment Scope
- **Store Location**: Central Dark Store Hub (`DHARGA-01`) located in Dharga Town, Sri Lanka (Coordinates: `6.438200, 80.027400`).
- **Delivery Service Area**: Exactly 4.00 km straight-line geodesic distance calculated via Haversine formula from the hub. Delivery addresses exceeding 4.00 km are rejected with an informative out-of-service message.
- **Store Network Growth**: Architecture and database schemas support multi-store configurations (`dark_stores`) from Day 1 to facilitate seamless Phase 2 expansion into Beruwala.

### 3.2 Catalog, Sourcing & Pricing
- **Catalog Breadth**: Initial catalog of 300–500 high-frequency grocery SKUs across dairy, eggs, bakery, snacks, dry pantry, beverages, and basic household items.
- **Sourcing Strategy (Phase 1)**: Products are procured on-demand from local vendors upon order placement. Store packing staff purchases and bags items before rider pickup.
- **Stock Tracking**: Catalog products operate in `UNTRACKED` inventory mode in Phase 1. Physical on-hand stock counts and bin management will activate in `TRACKED` mode during Phase 2.
- **Pricing Formula**:
  $$\text{Selling Price} = \text{Base Wholesale Purchase Cost} \times \left(1 + \frac{\text{Effective Markup \%}}{100}\right)$$
  - System default markup is 20.00%.
  - Specific products can override the default with a custom markup percentage.
- **Procurement Cost Tracking**: When packing staff sources items from the market, the actual purchase price is stamped into `order_items.actual_unit_cost` for precise gross profit reporting, without altering the customer's agreed checkout price.
- **Out-of-Stock Policy**: If an item is unavailable at local markets during sourcing, packing staff must contact the customer via phone/WhatsApp to confirm substitution or removal prior to bag sealing and dispatch.

### 3.3 Ordering & Delivery Window
- **Customer Ordering Availability**: 24 hours a day, 7 days a week (24/7).
- **Delivery Fulfillment Hours**: Daily from 8:00 AM to 9:00 PM (`Asia/Colombo` time).
- **After-Hours Ordering**: Orders placed between 9:00 PM and 8:00 AM are successfully accepted, marked with `scheduled_for` set to 8:00 AM the following morning, and queued for early-morning packing and dispatch.
- **Delivery Fee**: Flat 70.00 LKR applied to all orders.
- **Minimum Order Requirement**: No minimum order value. Customers can purchase single items.

### 3.4 Payment & Settlement
- **Phase 1 Payment**: Strictly **Cash on Delivery (COD)**.
- **Payment Lifecycle**:
  - `orders.payment_status` is initialized to `'PENDING'` upon order placement.
  - `orders.payment_status` transitions to `'PAID'` upon rider cash collection at customer doorstep.
- **Future Payments**: The backend data model and API architecture provision `payment_method_enum ('COD', 'ONLINE')` and `payments` transaction tracking for seamless Phase 3 online payment gateway (IPG) integration.

### 3.5 Order Lifecycle & State Machine
The canonical order lifecycle is strictly streamlined for quick-commerce execution without intermediate confirmation gates:

$$\text{PLACED} \longrightarrow \text{PACKED} \longrightarrow \text{OUT\_FOR\_DELIVERY} \longrightarrow \text{DELIVERED}$$

- **State Descriptions**:
  1. `PLACED`: Customer completes checkout. Order is queued for store staff sourcing and packing.
  2. `PACKED`: Staff has sourced all items, packed the delivery bag, recorded actual procurement cost, and staged the bag for rider pickup.
  3. `OUT_FOR_DELIVERY`: Delivery rider has picked up the bag and is navigating to the delivery address.
  4. `DELIVERED`: Goods handed over to the customer; COD cash collected and confirmed.
- **Exception States**:
  - `CANCELLED`: Order cancelled by customer (prior to `OUT_FOR_DELIVERY`) or by store admin.
  - `ITEM_UNAVAILABLE`: Item could not be sourced and customer opted to cancel.
  - `CUSTOMER_UNAVAILABLE`: Rider reached destination but customer could not be contacted after 3 attempts.
  - `FAILED`: Delivery could not be fulfilled due to mechanical breakdown or severe weather.
- **Customer Cancellation Rule**:
  - Customers may self-cancel their order via mobile app/web while status is `PLACED` or `PACKED`.
  - Once the order transitions to `OUT_FOR_DELIVERY`, customer self-service cancellation is strictly blocked.

### 3.6 Fleet & Dispatch Operations
- **Rider Fleet**: 1–2 dedicated delivery riders equipped with motorcycles and insulated bags.
- **Dispatch Model**: Manual assignment. The store manager inspects available riders and assigns orders directly from the staff dashboard.
- **Concurrency & Re-assignment**: Exactly one active delivery assignment is permitted per order. If a delivery attempt fails or a rider encounters an issue, operations can reassign the order to a replacement rider immediately.

### 3.7 Customer Communications & Notifications
- **Channels**: Transactional SMS (via NotifyLK) and WhatsApp Cloud API.
- **Trigger Events**:
  1. `ORDER_PLACED`: Order confirmation with items summary, scheduled delivery time, and total COD amount.
  2. `OUT_FOR_DELIVERY`: Rider dispatch alert with estimated delivery time.
  3. `ORDER_DELIVERED`: Thank you message and digital receipt confirmation.
  4. `ORDER_CANCELLED`: Cancellation confirmation.
- **Reliability Guarantee**: Notification dispatch uses an asynchronous transactional outbox pattern. Third-party notification failures never fail or roll back customer orders.

---

## 4. Platform Architecture & Applications

1. **Customer Android Mobile App**:
   - Native Android application built with Flutter (`apps/customer/blinkit-clone-Flutter-ecommerce-/`).
   - Primary customer vehicle for browsing catalog, managing local cart, placing COD orders, tracking live status, and receiving notifications.
2. **Customer iOS Experience**:
   - Responsive Web Application / Progressive Web App (PWA) as guaranteed Day 1 fallback for Safari/iOS.
   - iOS App Store build submitted in parallel.
3. **Rider Interface**:
   - Mobile-optimized interface for viewing assigned deliveries, recipient address/contact, doorstep cash collection, and status updates (`OUT_FOR_DELIVERY` → `DELIVERED`).
4. **Dark Store Operations Dashboard**:
   - Web application for packing staff and store managers to view packing queues, record actual sourcing costs, handle out-of-stock items, manage catalog prices, and manually assign riders.
5. **Backend Service**:
   - Single modular monolith Node.js/TypeScript REST API (`backend/api/`) backed by PostgreSQL 15+.

---

## 5. Phased Roadmap

- **Phase 1 (Current Focus)**:
  - Dharga Town dark store launch (4 km radius, 70 LKR fee, COD only, 20% markup, on-demand sourcing, manual rider assignment, 24/7 ordering with 8 AM–9 PM delivery window).
  - Native Android app + iOS Web/PWA fallback.
  - Backend foundation & core commerce modules.
- **Phase 2 (Regional Scaling)**:
  - Beruwala expansion and multi-dark-store hub support.
  - Transition from on-demand sourcing to stocked physical warehouse dark-store inventory (`TRACKED` mode).
  - Native iOS App Store general availability.
- **Phase 3 (Enterprise Quick-Commerce)**:
  - Online card and digital wallet payment gateway (IPG) integration.
  - Automated algorithmic rider dispatch and route optimization.
  - Partner merchant marketplace and fresh produce expansion.
