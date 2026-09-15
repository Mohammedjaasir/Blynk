# Blynk Implementation Status

**Current Phase:** Phase 1 Launch Foundation  
**Last Updated:** 2026-09-14  

---

## Stage 1 — Backend Foundation: COMPLETED

The foundational architecture and operational baseline for the Blynk backend have been implemented, verified, and migrated against PostgreSQL.

### Technology Stack
- **Node.js**: v20.20.2 LTS
- **TypeScript**: v5.7.3 (Strict mode, ES2022, NodeNext resolution)
- **Framework**: Express 4 with Helmet, CORS, and Pino structured logging
- **Database**: PostgreSQL 18 (Local service / Docker 16+ compatible)
- **Query Builder**: Kysely v0.27.5 over `pg` connection pool
- **Validation**: Zod v3.24.2

### Verified Deliverables
- [x] **PostgreSQL Schema Migration**: Migration `001_initial_schema.sql` applied cleanly to `blynk_db`.
  - 19 relational tables, 1 view (`v_product_catalog`), 10 custom PostgreSQL enums, all check constraints, and operational partial indexes.
  - Partial unique index `uq_deliveries_active_assignment` verified in PostgreSQL.
- [x] **Deterministic Rollback**: Migration rollback (`migrate:down`) and re-application (`migrate:up`) verified.
- [x] **Database Seed**: Development seed (`dev_seed.ts`) executed and verified:
  - Dharga Town central hub (`DHARGA-01`), 4 km radius, 70 LKR fee, 20% markup, 08:00–21:00 operating window.
  - 2 categories, 5 SKUs with dual procurement cost modeling.
  - Test customer (`Ahmed Rizvi`, `+94771234567`), customer address, test rider (`Farhan Mohamed`, `+94779876543`), packing staff, and admin.
- [x] **Health Check Endpoint**: `GET /health` verified live on port 3000, reporting database status `connected` with latency.
- [x] **Automated Test Suite**: 18 tests passing across 4 Vitest test suites (health, utilities, error format, schema validation).
- [x] **Build & Lint**: `npm run typecheck` and `npm run build` compiled with 0 errors.

---

## Stage 2 — Authentication & OTP: COMPLETED

Production-ready mobile-number OTP authentication, customer auto-registration, token rotation, and role-based access control have been implemented, verified, and integrated into the modular monolith.

### Cryptographic Security & Policies
- **Phone Number Normalization**: Sri Lankan mobile numbers strictly validated and normalized to E.164 standard (`+947XXXXXXXX`).
- **OTP Generation & Hashing**: 6-digit cryptographically secure OTP (`crypto.randomInt`), stored hashed via `bcrypt` (10 rounds). Plaintext OTP is never persisted.
- **OTP Lifetime & Policies**: 5-minute validity window, max 3 verification attempts per challenge, invalidation of prior active challenges upon new request.
- **Rate Limiting**: Sliding window rate limiting: max 3 OTP requests/hour per phone number, max 15 requests/15 minutes per IP address.
- **Auto-Registration**: First-time OTP verification automatically provisions customer with role `CUSTOMER`. Existing users retain their existing role (`ADMIN`, `RIDER`, `OPS`). Deactivated users are blocked with 403 `ACCOUNT_DEACTIVATED`.
- **JWT Access Tokens**: HS256 signed, 15-minute expiration, containing `sub`, `phone`, `role`.
- **Refresh Token Rotation**: Single-use cryptographically random refresh tokens (40 random bytes), stored as SHA-256 digests in PostgreSQL, 30-day expiration. Automatic reuse/replay detection immediately revokes all user sessions.
- **Concurrency & Race Condition Safety**: Atomic row-level locking (`FOR UPDATE`) on OTP challenge consumption and token rotation, preventing race-condition double-consumption.

### Endpoints Implemented
- `POST /api/v1/auth/otp/request`: Request OTP challenge with rate limiting and Sri Lankan number normalization.
- `POST /api/v1/auth/otp/verify`: Verify OTP, auto-register customer, and issue JWT + rotating refresh token.
- `POST /api/v1/auth/refresh`: Single-use refresh token rotation with replay detection.
- `POST /api/v1/auth/logout`: Revoke active refresh token.
- `GET /api/v1/auth/me`: Authenticated profile retrieval guarded by `requireAuth`.
- Role-based access control (`requireRoles`) verified against protected modules (`ADMIN`, `RIDER`).

### Automated Test Suite
- **40 tests passing across 5 Vitest test suites** (100% passing):
  - `tests/auth.test.ts` (22 tests)
  - `tests/health.test.ts` (2 tests)
  - `tests/utils.test.ts` (7 tests)
  - `tests/validation.test.ts` (5 tests)
  - `tests/error.test.ts` (4 tests)

---

## Stage 3 — Catalog & Authoritative Pricing: COMPLETED

Public category and product catalog browsing, parameterized product search, authoritative selling price calculations, and admin category/SKU management have been implemented, verified, and integrated.

### Business Rules & Pricing Engine
- **Global Default Markup**: 20.00% markup over base wholesale procurement cost (`system_configurations.default_markup`).
- **Product-Specific Markup Override**: Individual products support custom markup overrides (`products.custom_markup_percent`, e.g., 15% on Butter, 10% on Eggs).
- **Authoritative Pricing**: Customers cannot submit or override prices, markups, or costs. Prices are calculated authoritatively by the backend with strict 2-decimal rounding:
  $$\text{selling\_price} = \text{ROUND}\left(\text{purchase\_cost} \times \left(1 + \frac{\text{effective\_markup}}{100}\right), 2\right)$$
- **Zero Sensitive Cost Leakage**: Customer endpoints strictly omit internal procurement figures (`purchase_cost`, `custom_markup_percent`, `effective_markup_percent`).
- **Phase 1 Sourcing Model**: Operates with `UNTRACKED` dark store inventory; product availability is governed by `products.is_available`.

### Endpoints Implemented
- **Customer Endpoints**:
  - `GET /api/v1/categories`: Lists active categories ordered by `display_order ASC, name ASC`.
  - `GET /api/v1/products`: Lists active products with pagination (`page`, `limit`), category filtering (`category_id`, `category_slug`), availability filtering, and safe parameterized search (`search`).
  - `GET /api/v1/products/:id`: Retrieves single active product by UUID or slug with authoritative selling price.
- **Admin Endpoints (`requireAuth` + `requireRoles('ADMIN')`)**:
  - `GET /api/v1/admin/categories`: Lists all categories (with optional active filter).
  - `POST /api/v1/admin/categories`: Creates category with slug validation/generation.
  - `PATCH /api/v1/admin/categories/:id`: Updates category fields or deactivates.
  - `GET /api/v1/admin/products/:id`: Retrieves full product details including procurement cost and markup percentages.
  - `POST /api/v1/admin/products`: Creates new SKU with base cost, unit, pack size, and optional markup override.
  - `PATCH /api/v1/admin/products/:id`: Updates product details, prices, markups, or availability.

### Automated Test Suite
- **66 tests passing across 6 Vitest test suites** (100% passing):
  - `tests/catalog.test.ts` (26 tests)
  - `tests/auth.test.ts` (22 tests)
  - `tests/utils.test.ts` (7 tests)
  - `tests/validation.test.ts` (5 tests)
  - `tests/error.test.ts` (4 tests)
  - `tests/health.test.ts` (2 tests)

---

## Stage 4 — Orders, Checkout & COD Settlement: COMPLETED

The complete order lifecycle, customer address book, 4.00 km geofence enforcement, 24/7 ordering with operating-window scheduling, atomic checkout pipeline, store packing operations, manual rider assignment, and doorstep COD cash collection have been implemented, verified, and integrated.

### Business Rules & Operational Logic Enforced
- **Customer Address Book**: Full CRUD with coordinate validation (`latitude`, `longitude`), default address setting with atomic unsetting of prior defaults, and IDOR customer isolation.
- **Geofence Enforcement**: 4.00 km maximum radius calculated via Haversine against Dharga Town hub (`6.438200, 80.027400`). Addresses outside 4 km are saved in the address book for future zone expansion, but orders attempted to those addresses are rejected with HTTP 422 `DELIVERY_OUTSIDE_RADIUS`.
- **24/7 Ordering & Operating Window**: Orders placed outside 08:00–21:00 `Asia/Colombo` operating hours are accepted 24/7 and automatically scheduled for `08:00 AM` on the next operating day via `orders.scheduled_for`.
- **Atomic Checkout & Authoritative Sourcing**:
  - `Idempotency-Key` prevents duplicate charges and double order creation.
  - Sourcing prices, markup, line item subtotals, flat 70.00 LKR delivery fee, and COD payment record are generated inside a single PostgreSQL transaction with row-level product locking.
  - Complete historical snapshot of recipient address and contact information copied into `orders` table (no FK dependency on mutable `addresses` table).
  - Outbox SMS notification automatically queued upon order creation.
- **Customer Cancellation Window**: Cancellation permitted online only while order is in `PLACED` or `PACKED` state. Once marked `OUT_FOR_DELIVERY` or later, cancellation is blocked with HTTP 400 `ORDER_ALREADY_OUT_FOR_DELIVERY`.
- **Store Operations & Packing Queue**: Store staff and admins view real-time packing queue, resolve out-of-stock items during sourcing with automatic recalculation of order total and COD payment amount, and progress order to `PACKED`.
- **Rider Assignment**: Manual rider assignment guarded by partial unique constraint `uq_deliveries_active_assignment`, preventing multiple active rider assignments to the same order.
- **Rider Delivery & Doorstep COD Settlement**:
  - Rider workflow endpoints: `PICKED_UP` (automatically advances order to `OUT_FOR_DELIVERY`), `ARRIVED_AT_CUSTOMER`, `DELIVERED`, `FAILED`.
  - Cash collection validation ensures exact collection match with order total, atomically updating `deliveries` to `DELIVERED`, `payments` to `PAID`, and `orders` to `DELIVERED`.

### Endpoints Implemented
- **Customer Address Book (`/api/v1/me/addresses`)**:
  - `POST /api/v1/me/addresses`: Create customer delivery address.
  - `GET /api/v1/me/addresses`: List customer addresses with default prioritized.
  - `GET /api/v1/me/addresses/:id`: Retrieve single address.
  - `PATCH /api/v1/me/addresses/:id`: Update address or set as default.
  - `DELETE /api/v1/me/addresses/:id`: Soft-delete address.
- **Customer Orders & Checkout (`/api/v1/orders`)**:
  - `POST /api/v1/orders`: Atomic checkout with geofence check and idempotency.
  - `GET /api/v1/orders`: List customer orders with status filtering and pagination.
  - `GET /api/v1/orders/:id`: Detailed order breakdown with items, payment, and status history.
  - `POST /api/v1/orders/:id/cancel`: Customer self-service cancellation window.
- **Store Operations & Admin Orders (`/api/v1/admin`)**:
  - `GET /api/v1/admin/packing-queue`: Sourcing and packing queue.
  - `GET /api/v1/admin/orders`: Full administrative order search and filtering.
  - `GET /api/v1/admin/orders/:id`: Full administrative order view.
  - `PATCH /api/v1/admin/orders/:id/status`: Update order status (e.g. to `PACKED`).
  - `POST /api/v1/admin/orders/:id/resolve-item`: Mark item unavailable and recalculate order total.
  - `POST /api/v1/admin/orders/:id/assign-rider`: Manual rider assignment.
- **Rider Workflow (`/api/v1/riders` & `/api/v1/rider`)**:
  - `GET /api/v1/riders/deliveries`: List active assigned deliveries.
  - `GET /api/v1/riders/deliveries/:id`: Delivery details with customer location & instructions.
  - `POST /api/v1/riders/deliveries/:id/status`: Transition delivery status (`PICKED_UP`, `ARRIVED_AT_CUSTOMER`, `FAILED`).
  - `POST /api/v1/riders/deliveries/:id/collect-cod`: Complete doorstep COD cash collection and mark order delivered.

### Automated Test Suite
- **92 tests passing across 7 Vitest test suites** (100% passing):
  - `tests/orders.test.ts` (26 tests)
  - `tests/catalog.test.ts` (26 tests)
  - `tests/auth.test.ts` (22 tests)
  - `tests/utils.test.ts` (7 tests)
  - `tests/validation.test.ts` (5 tests)
  - `tests/error.test.ts` (4 tests)
  - `tests/health.test.ts` (2 tests)

---

## Upcoming Implementation Roadmap

### Stage 5 — Outbox Notification Worker (NEXT)
- Background polling daemon for notifications (`QUEUED` $\rightarrow$ `SENT` / `FAILED`).
- Outbox worker for SMS (NotifyLK gateway integration with mock/dry-run fallbacks).
- Notification deduplication and retry mechanism with exponential backoff.

### Stage 6 — Production Hardening & Deployment Prep
- Docker containerization for backend API and notification worker.
- CI/CD pipelines, database migration automation, and environment configuration profiles.
