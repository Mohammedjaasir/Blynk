# Blynk Implementation Status

**Current Phase:** Phase 1 Launch Foundation  
**Last Updated:** 2026-09-14  

---

## Stage 1 â€” Backend Foundation: COMPLETED

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
  - Dharga Town central hub (`DHARGA-01`), 4 km radius, 70 LKR fee, 20% markup, 08:00â€“21:00 operating window.
  - 2 categories, 5 SKUs with dual procurement cost modeling.
  - Test customer (`Ahmed Rizvi`, `+94771234567`), customer address, test rider (`Farhan Mohamed`, `+94779876543`), packing staff, and admin.
- [x] **Health Check Endpoint**: `GET /health` verified live on port 3000, reporting database status `connected` with latency.
- [x] **Automated Test Suite**: 18 tests passing across 4 Vitest test suites (health, utilities, error format, schema validation).
- [x] **Build & Lint**: `npm run typecheck` and `npm run build` compiled with 0 errors.

---

## Stage 2 â€” Authentication & OTP: COMPLETED

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

## Stage 3 â€” Catalog & Authoritative Pricing: COMPLETED

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

## Stage 4 â€” Orders, Checkout & COD Settlement: COMPLETED

The complete order lifecycle, customer address book, 4.00 km geofence enforcement, 24/7 ordering with operating-window scheduling, atomic checkout pipeline, store packing operations, manual rider assignment, and doorstep COD cash collection have been implemented, verified, and integrated.

### Business Rules & Operational Logic Enforced
- **Customer Address Book**: Full CRUD with coordinate validation (`latitude`, `longitude`), default address setting with atomic unsetting of prior defaults, and IDOR customer isolation.
- **Geofence Enforcement**: 4.00 km maximum radius calculated via Haversine against Dharga Town hub (`6.438200, 80.027400`). Addresses outside 4 km are saved in the address book for future zone expansion, but orders attempted to those addresses are rejected with HTTP 422 `DELIVERY_OUTSIDE_RADIUS`.
- **24/7 Ordering & Operating Window**: Orders placed outside 08:00â€“21:00 `Asia/Colombo` operating hours are accepted 24/7 and automatically scheduled for `08:00 AM` on the next operating day via `orders.scheduled_for`.
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

## Stage 5 â€” Outbox Notification Worker: COMPLETED

The production-ready, transactional Outbox Notification Worker subsystem has been implemented, verified, and integrated against PostgreSQL.

### Architecture & Operational Invariants
- **Transactional Outbox Decoupling**: Business transactions (order placement, customer cancellation, item out-of-stock resolution, rider assignment, out-for-delivery progression, and doorstep COD collection) commit outbox notification records atomically in PostgreSQL inside their database transaction. External SMS (NotifyLK) and WhatsApp Cloud API dispatches happen asynchronously outside DB transactions, preventing third-party latency spikes or outages from ever impacting customer checkouts.
- **Concurrency Safety via Row-Level Locking**: Multiple worker processes safely coordinate using `SELECT ... FOR UPDATE SKIP LOCKED` inside a short transaction, claiming batches without contention or duplicate sends.
- **Provider Abstraction**: Unified `NotificationProvider` interface with adapters:
  - `SmsProvider`: Sri Lankan number formatting (`947XXXXXXXX`) with NotifyLK integration and development/test mock fallback.
  - `WhatsAppProvider`: E.164 phone formatting with Meta WhatsApp Cloud API integration and development/test mock fallback.
- **Bounded Exponential Backoff**: Transient errors (timeouts, rate limits, 5xx) schedule retries with exponential backoff:
  $$\text{delay} = \min\left(5000 \times 2^{\text{attempts}-1}, 3600000\right)$$
  Max attempts (default 3) are enforced; unrecoverable permanent errors (malformed phone numbers, unsupported channels) immediately transition to `FAILED`.
- **Crash Recovery Lease Mechanism**: Jobs stuck in `PROCESSING` whose `locked_at` exceeds the 5-minute lease threshold (`NOTIFICATION_PROCESSING_TIMEOUT_MS`) are automatically reclaimed and retried.
- **Security & Data Sanitization**: Customer notification messages and outbox payloads strictly strip sensitive internal fields (`purchase_cost`, `actual_unit_cost`, `markup_percentage_applied`, `password`, `otp_hash`, `token`). Only customer-facing order numbers and retail LKR totals are rendered.
- **Admin Observability Endpoint**: `GET /api/v1/admin/notifications` returns real-time queue counts (`queued`, `processing`, `sent`, `failed`) and the 20 most recent failed dispatches.

### Verified Deliverables
- [x] **Database Migration 002**: `002_outbox_worker_extensions.sql` and `002_outbox_worker_extensions_down.sql` applied, rolled back, and re-applied cleanly.
- [x] **Type Definitions**: Updated `types.ts` with `PROCESSING` status and worker tracking fields (`attempts`, `max_attempts`, `next_attempt_at`, `locked_at`, `locked_by`, `failed_at`, `updated_at`).
- [x] **Stage 4 Integration**: Transactional outbox records wired into:
  - `ORDER_PLACED` (checkout)
  - `ORDER_CANCELLED` (cancellation)
  - `ITEM_UNAVAILABLE` (packing resolution)
  - `RIDER_ASSIGNED` (store dispatch)
  - `OUT_FOR_DELIVERY` (rider pick-up)
  - `DELIVERED` & `COD_PAYMENT_CONFIRMED` (doorstep cash settlement)
- [x] **Daemon Lifecycle**: Integrated into `server.ts` with graceful worker shutdown.
- [x] **Automated Tests**: **108 tests passing across 8 Vitest test suites (100% pass rate)**.

---

## Stage 6 â€” Inventory & Sourcing Subsystem: COMPLETED

The production-ready Inventory & Sourcing subsystem has been implemented, verified, and integrated into the Blynk backend.

### Architecture & Operational Invariants
- **Phase 1 Sourcing Model (`UNTRACKED`)**:
  - Products primarily operate in on-demand sourcing mode upon customer order placement.
  - Sourcing purchase price is recorded into `order_items.actual_unit_cost` via `POST /api/v1/admin/orders/:id/items/:itemId/source`.
  - **Critical Cost Invariants**:
    1. `actual_unit_cost` remains `NULL` until actual procurement is completed.
    2. `estimated_unit_cost` is **NEVER** overwritten.
    3. `unit_selling_price` and customer order totals are **NEVER** modified after sourcing.
    4. Customer APIs (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, `POST /api/v1/orders`) strictly sanitize items to hide `estimated_unit_cost`, `actual_unit_cost`, and `markup_percentage_applied`.
- **Foundational Tracked Warehouse Mode (`TRACKED`)**:
  - Supports switching individual products between `UNTRACKED` and `TRACKED` mode (`PATCH /api/v1/admin/inventory/:productId/mode`).
  - Stock levels (`quantity_on_hand`, `quantity_reserved`, `quantity_available`) are managed atomically.
  - Database constraint `chk_inv_qty_available` guarantees `quantity_on_hand >= quantity_reserved` (available inventory cannot become negative).
  - All stock adjustments (restocks, audit adjustments, damage write-offs, and order fulfillments) append immutable records to `inventory_adjustments`.
- **Dedicated Sourcing Audit Ledger**:
  - Sourcing operations insert immutable records into `sourcing_records` associating `order_id`, `order_item_id`, `product_id`, `supplier_id`, `quantity_sourced`, `estimated_unit_cost`, `actual_unit_cost`, and `sourced_by_user_id`.
- **Market Suppliers Management**:
  - Full CRUD for local market suppliers (`GET`, `POST`, `PATCH /api/v1/admin/suppliers`), tracking names, codes, contacts, and active status.
- **Stage 4 Out-of-Stock Integration**:
  - Supports `POST /api/v1/admin/orders/:id/resolve-item` and `PATCH /api/v1/admin/orders/:id/items/:itemId`.
  - Unavailable items keep `actual_unit_cost` as `NULL`, recalculate order totals and COD payments atomically, and enqueue outbox notifications.
  - Sourcing an unavailable item is explicitly rejected (`CANNOT_SOURCE_UNAVAILABLE_ITEM`).
- **RBAC & Operational Security**:
  - Only `ADMIN` and `PACKING_STAFF` can source items and view sourcing queues.
  - `CUSTOMER` and `RIDER` roles are strictly blocked from sourcing with `403 FORBIDDEN`.
  - Prevented IDOR across orders and items.

### Endpoints Implemented
- **Operational Sourcing**:
  - `POST /api/v1/admin/orders/:id/items/:itemId/source`: Record actual procurement cost and supplier.
  - `GET /api/v1/admin/orders/:id/sourcing`: Order sourcing progress, metrics, and item details.
  - `POST /api/v1/admin/orders/:id/resolve-item`: Canonical out-of-stock resolution.
- **Tracked Inventory & Ledger**:
  - `GET /api/v1/admin/inventory`: Paginated inventory levels with low-stock filtering.
  - `GET /api/v1/admin/inventory/:productId`: Product stock levels and adjustment history.
  - `PATCH /api/v1/admin/inventory/:productId/mode`: Toggle tracking mode (`UNTRACKED` / `TRACKED`).
  - `POST /api/v1/admin/inventory/:productId/adjust`: Record stock adjustments with ledger entry.
- **Suppliers Management**:
  - `GET /api/v1/admin/suppliers`: List active market suppliers.
  - `POST /api/v1/admin/suppliers`: Create supplier record.
  - `GET /api/v1/admin/suppliers/:id`: Supplier detail lookup.
  - `PATCH /api/v1/admin/suppliers/:id`: Update supplier information.

### Verified Deliverables
- [x] **Database Migration 003**: `003_sourcing_and_inventory.sql` and `003_sourcing_and_inventory_down.sql` applied, rolled back, and re-applied cleanly.
- [x] **Type Definitions**: Updated `types.ts` with `SuppliersTable` and `SourcingRecordsTable`.
- [x] **Seed Data**: Populated Phase 1 local suppliers in `dev_seed.ts`.
- [x] **Automated Tests**: **140 tests passing across 9 Vitest test suites (100% pass rate)**.
- [x] **Health Check**: `GET /health` returns HTTP 200 with `database: connected`.

---

## Stage 7 â€” Production Hardening & Deployment Prep: COMPLETED

The deployment packaging, multi-stage containerization, process decoupling, and CI/CD automation for the Blynk backend have been implemented and verified.

### Architecture & Operational Invariants
- **Multi-Stage Dockerfile**: Multi-stage build (`node:20-alpine`) separating dependency resolution, TypeScript compilation, asset bundling, and runtime. Runs as non-root user (`USER node`, UID 1000) with zero secrets baked into image.
- **Compiled Migration Runner**: Build step bundles SQL migration files into `dist/database/migrations` and enables `node dist/database/migrate.js up|down` execution directly in production.
- **Decoupled Worker Architecture**: Created standalone entrypoint `src/worker.ts` (`node dist/worker.js`) to allow the Transactional Outbox Worker to run as a distinct service from the API server while sharing the same codebase and database connection pool.
- **Graceful Shutdown**: Added deterministic `SIGTERM` and `SIGINT` signal handlers across both API and Worker processes, properly draining the PostgreSQL pool and stopping in-flight outbox dispatch loops with a 10s safety timeout.
- **Production Environment Invariants**: Enforced strict validation preventing development placeholder secrets, wildcard CORS, localhost database URLs, or mock SMS fallbacks when `NODE_ENV=production`.
- **Docker Compose Topology**: Orchestrates PostgreSQL 16 Alpine with readiness checks, a deterministic one-shot migration runner, the Express REST API, and the outbox worker across a dedicated bridge network with persistent volume storage.
- **GitHub Actions CI/CD**: Automated pipeline validating linting, typechecking, production compilation, PostgreSQL service container migrations, and the full automated test suite on every PR and push to `main`.
- **Automated Tests**: **156 tests passing across 10 Vitest test suites (100% pass rate)**.

### Verified Deliverables
- [x] **Dockerfile**: Production multi-stage Dockerfile (`backend/api/Dockerfile`).
- [x] **.dockerignore**: Created in both `backend/api/.dockerignore` and root `.dockerignore`.
- [x] **Docker Compose**: Orchestration configurations (`docker-compose.yml` and `backend/docker-compose.yml`).
- [x] **Worker Process**: Standalone worker entrypoint `src/worker.ts` and npm script `start:worker`.
- [x] **GitHub Actions Workflow**: Fully configured CI workflow in `.github/workflows/ci.yml`.
- [x] **Automated Tests**: Added `tests/deployment.test.ts` (16 tests verifying production environment guards, migration bundling, worker lifecycles, and health checks). Total: **156/156 passing**.
- [x] **Deployment Guide**: Comprehensive guide in `docs/06-deployment/deployment.md`.

---

## Stage 8 â€” Observability & Operational Resilience: COMPLETED

Production-grade observability, operational resilience, and error sanitization have been implemented across the Blynk backend.

### Observability Architecture

#### Request Correlation
- **X-Request-ID Middleware**: Every inbound HTTP request is assigned a unique UUIDv4 correlation ID via `requestIdMiddleware`.
- **Client Propagation**: If the client supplies an `x-request-id` header, it is adopted as-is. Otherwise a fresh UUID is generated.
- **Response Echo**: The correlation ID is always echoed back in the `x-request-id` response header.
- **Error Embedding**: The `requestId` is injected into every error response body (4xx and 5xx) for client-side and support correlation.

#### Structured Logging (Pino)
- **Zero-PII Logging**: Pino configured with a redact list covering `req.headers.authorization`, `req.headers.cookie`, `req.body.otp`, `req.body.code`, `req.body.password`, `user.phone`, `user.email`, `phone`, `email`, `password`, `token`, `accessToken`, `refreshToken`, `otp_hash`, and `token_hash`. All redacted values are replaced with `[REDACTED]`.
- **HTTP Request Logging**: `pino-http` middleware correlates request logs to the `x-request-id` and classifies log levels: `error` (5xx), `warn` (4xx), `info` (2xx/3xx).
- **Development Formatting**: `pino-pretty` transport in development with colorized, timestamped, human-readable output.
- **Production Ndjson**: Raw structured ndjson in production for log aggregator ingestion.

#### In-Process Business Metrics (`src/utils/metrics.ts`)
A lightweight zero-dependency process-scoped singleton (`MetricsService`) counts key operational events without external observability infrastructure:

| Domain | Counters |
|---|---|
| **Auth** | `otpRequested`, `otpVerified`, `otpFailed`, `tokenRefreshed`, `tokenRevoked` |
| **Orders** | `checkoutAttempts`, `checkoutSucceeded`, `checkoutFailed`, `ordersCreated`, `ordersCancelled`, `ordersDelivered` |
| **Notifications** | `enqueued`, `dispatched`, `failed`, `permanentlyFailed` |
| **Errors** | `clientErrors`, `serverErrors`, `unhandledRejections` |
| **HTTP** | `requestsTotal`, `requests2xx`, `requests4xx`, `requests5xx` |

Counters reset on process restart (intended for operational dashboards, not long-term analytics).

#### HTTP Metrics Middleware (`src/middleware/http-metrics.middleware.ts`)
- Registered globally in `app.ts` immediately after pino-http.
- Hooks `res.on('finish')` to classify the final HTTP status code into buckets.
- Increments the global `metrics` singleton â€” no blocking I/O.

#### `/ready` Liveness Probe
- `GET /ready` â€” returns 200 immediately if the process is alive and Express routers are initialized.
- Does **not** probe the database (avoids false negatives when DB is temporarily unavailable during init).
- Returns `{ status: 'ready', timestamp, uptime }`.
- Used by container orchestrators for readiness/liveness probes.

#### `/health` Enriched with Pool Stats
- `GET /health` now includes PostgreSQL connection pool statistics: `{ total, idle, waiting }`.
- Returns 503 if the database probe fails.

#### Admin Operations Endpoints (RBAC: ADMIN)

| Endpoint | Description |
|---|---|
| `GET /api/v1/admin/operations/metrics` | Returns `MetricsSnapshot` with aggregate counters since last restart |
| `GET /api/v1/admin/operations/status` | Returns DB health + pool stats + metrics snapshot combined |

Both endpoints require a valid `ADMIN` JWT Bearer token. Returns 401 without token, 403 for non-ADMIN roles.

#### Error Sanitization
- Unhandled 5xx errors: message is masked to `'An unexpected internal server error occurred'` in client response.
- Known `AppError` (4xx): message, code, and details are passed through to the client as intended.
- Stack traces: only included in response body during `NODE_ENV=development` for 500+ errors.
- Internal error details (DB messages, stack traces) are always logged server-side with the correlation ID for debugging.

### New Files Added
- `src/utils/metrics.ts` â€” In-process business metrics singleton with `MetricsService` class and process-scoped `metrics` export.
- `src/middleware/http-metrics.middleware.ts` â€” HTTP metrics collection middleware using `res.on('finish')`.
- `tests/observability.test.ts` â€” 47 test cases covering all Stage 8 deliverables.

### Modified Files
- `src/app.ts` â€” Wired `httpMetricsMiddleware`, added `/ready` endpoint, enriched `/health` with pool stats.
- `src/modules/admin/index.ts` â€” Added `GET /operations/metrics` and `GET /operations/status` endpoints with ADMIN RBAC.

### Verified Deliverables
- [x] **Request Correlation**: `x-request-id` generated, propagated, echoed, and embedded in error bodies.
- [x] **Structured Logging**: Pino with PII redaction, `pino-http` correlation, level-based classification.
- [x] **In-Process Metrics**: `MetricsService` singleton with all business event counters and `snapshot()`.
- [x] **HTTP Metrics Middleware**: Global counter for request totals and 2xx/4xx/5xx classification.
- [x] **/ready Liveness Probe**: Lightweight 200 OK process-alive check, no DB probe.
- [x] **/health with Pool Stats**: PostgreSQL pool `total`/`idle`/`waiting` counts in health response.
- [x] **Admin Operations Metrics**: `GET /admin/operations/metrics` â†’ ADMIN-guarded `MetricsSnapshot`.
- [x] **Admin Operations Status**: `GET /admin/operations/status` â†’ ADMIN-guarded combined dashboard.
- [x] **Error Sanitization**: 500 messages masked; 4xx messages visible; requestId always embedded.
- [x] **PII Redaction Contract**: OTP, password, authorization header, tokens all redacted in logs.
- [x] **Automated Tests**: 47 new tests in `tests/observability.test.ts`. **Total: 204/204 passing**.

---

---

## Stage 9 — Security Hardening & Abuse Protection (COMPLETE)

> **Status:** COMPLETE  
> **Test Suite:** 268/268 passing across 12 test files  
> **Regression Status:** 0 regressions (Stage 1 through Stage 8 verified)  
> **Security Suite:** 63 new dedicated security and abuse protection test cases in 	ests/security.test.ts

### Key Security Controls Implemented & Verified
- [x] **Authentication & Cryptography:** Secure CSPRNG OTP generation, bcrypt token hashing, constant-time comparisons, JWT expiration/signature verification, refresh token rotation with replay detection.
- [x] **OTP Abuse Protection:** In-memory sliding window rate limiting (3 requests/phone/hour), max 3 verification attempts, 5-minute TTL, non-enumerating generic error messages.
- [x] **Role-Based Access Control (RBAC):** Strict role boundaries across CUSTOMER, RIDER, PACKING_STAFF, and ADMIN using requireAuth and requireRoles middleware.
- [x] **IDOR Protections:** Customer and rider object ownership verified on all order, address, and delivery operations (order_id + customer_id, delivery_id + rider_id).
- [x] **Authoritative Server Pricing:** Client price and cost overrides are completely ignored and stripped by Zod schemas and server-side calculation.
- [x] **Input Validation & Sanitization:** Strict Zod validation on UUIDs, phone numbers, quantities, enums, bounded pagination limits (max 100), and 1MB JSON body size limit.
- [x] **HTTP & Header Security:** Helmet security headers, CORS origin whitelisting, express JSON payload limit.
- [x] **Information Leakage Prevention:** Stack traces and internal database errors stripped in production; x-request-id correlated error payloads.

---

---

## Stage 10 — Production Go-Live & Final Launch Verification (COMPLETE)

> **Status:** CONDITIONAL GO-LIVE  
> **Test Suite:** 269/269 passing across 12 test files  
> **Regression Status:** 0 regressions (Stages 1–10 fully verified)  
> **Launch Report:** `docs/05-implementation/stage-10-go-live-report.md`

### Production Readiness Summary
- [x] **Full Stack Integration:** All modules (Auth, Catalog, Orders, Notifications, Inventory, Observability, Security) verified end-to-end.
- [x] **Production Schema & Database:** Migrations `001_initial_schema.sql` → `002_outbox_worker_extensions.sql` → `003_sourcing_and_inventory.sql` verified with deterministic runner.
- [x] **Container Packaging:** Hardened multi-stage non-root Alpine Docker image with separate API and Outbox Worker containers.
- [x] **Health & Observability:** Deep `/health` probe with database connection pool statistics, lightweight `/ready` liveness check, structured logging with PII redaction, and in-process operational metrics.
- [x] **Operational Prerequisites:** Identified and documented external launch requirements (live SMS credentials, production TLS/DNS, production database instance).

---

## Final Project Status
STATUS: CONDITIONAL GO-LIVE (Ready for deployment with live production environment credentials)



---

## Admin/Ops Phase — Catalog, Product Images & Home Promotions (COMPLETE)

> **Report:** `docs/05-implementation/blynk-admin-catalog-report.md`
> **Admin scope:** Products, Categories, Promotions (+ Dashboard). Inventory and Rider are separate future applications, not Admin modules.
> **Test Suite (latest full run):** backend 292 passing · admin app 10 passing · customer app 167 passing · `flutter analyze` 2 pre-existing infos
> **Live E2E:** `integration_test/admin_to_customer_flow_test.dart` passing against the real backend, plus the existing customer journey still green

### Delivered now
- [x] **Admin/Ops web app:** new `apps/admin` (React + Vite + TypeScript). Dashboard, Products (list/add/edit/enable/disable), Categories, Home Promotions.
- [x] **Authentication & RBAC:** reuses the existing OTP login; ADMIN role required. Backend `requireAuth` + `requireRoles('ADMIN')` enforces every admin route — anonymous 401, customer 403, proven by tests.
- [x] **Product management:** existing product schema only; selling price stays a backend calculation (`purchase_cost × (1 + markup/100)`); cost and markup never reach the customer DTO.
- [x] **Product images:** admin upload/replace/remove with preview; browser-side downscale to ≤1200 px WebP; 2 MB API cap; magic-number sniffing; URL stored, never image bytes.
- [x] **Media storage:** new `MediaStorage` abstraction with a local-disk implementation served at `/uploads`; no third-party service introduced. Documented in the phase report.
- [x] **Active/inactive:** existing soft-disable (`is_active`); disabled products leave the customer catalog while historical orders stay intact. No delete behaviour invented.
- [x] **Categories:** add, edit, activate/deactivate — the operations the backend actually supports (there is no delete endpoint, and the UI says so).
- [x] **Home promotions:** new `promotions` table (migration `004`), customer endpoint `GET /promotions` (active, ordered) and admin CRUD + bulk reorder; optional CTA to a category, a product, or the whole catalog.
- [x] **Customer carousel connected:** hardcoded campaigns removed; the Flutter carousel renders backend promotions in the admin's order and hides itself entirely when there are none or the request fails.
- [x] **Promotion background control:** migration `005` adds `background_type` (SOLID / GRADIENT / IMAGE), `background_color`, `background_color_end`, `background_image_url`. Validated on create and on the merged row for partial updates. The admin editor has Content / Foreground visual / Background (named swatches and gradient presets, or an uploaded image) / live Customer preview / Settings, with no raw CSS. The carousel paints exactly what the admin chose — no palette of its own — switches to light text on dark or image backgrounds, and leaves no empty frame when there is no foreground image. Browser verified admin → customer.
- [x] **Visual audit:** eight generic-design patterns found in the admin and refined in the visual layer only (split login, figures strip + "Needs a look" dashboard, type scale, 4 px radius, left-bar sidebar, dot status labels, 1600 px layout). Row actions were restyled, not restructured.
- [x] **Brand logo:** the supplied logo replaces every previous logo — customer login header, splash, launcher icons (Android, iOS, macOS, Windows, web) and favicon; admin sidebar, login panel and favicon.
- [x] **New admin endpoint `GET /admin/products`:** closes a real gap — the only product listing was customer-facing and active-only, so disabled products were invisible to operators.

### Application boundaries (architecture correction)
Blynk is four interfaces over one backend and one database: **Customer**, **Admin**, **Inventory** (later) and **Rider** (later). They are separate products with different users and permissions, not modules of each other.
- [x] **Admin sidebar contains only** Dashboard · Catalog (Products, Categories) · Home (Promotions) — no Inventory or Rider entries, not even disabled placeholders. Pinned by a test.
- [x] **Stock tracking removed from Admin:** `tracking_mode` lives on the `inventory` table and was being ignored by the product schema, so the control was inert. It belongs to the Inventory app.
- [ ] **Inventory app** — separate application, **next phase**. Backend inventory module untouched.
- [ ] **Rider app** — separate application, later phase.

### Known limitations
- Admin UI click-tested in Microsoft Edge (sign-in, dashboard, Products, Categories, promotion editor and save); product/category edit and promotion delete were not clicked through (covered by tests).
- Admin access tokens (15 min) are renewed automatically through `/auth/refresh` (single shared refresh); a refused refresh signs the operator out.
- The E2E test leaves a disabled product behind on every run (there is no product delete endpoint); accumulated rows were cleaned up by hand.
- Logo source is a 1024 px JPEG, so the largest store icons are slightly soft; the onboarding photo still shows the old wordmark.
- Local disk media storage is single-host; the S3/GCS implementation of `MediaStorage` is needed before multi-instance deployment. No virus scanning.
- Server-side image reprocessing is not implemented (downscaling is client-side).
- Promotion scheduling (start/end windows) deliberately not modelled.
- Admin product table is unpaginated (limit 200).

STATUS: ADMIN SCOPE CLEAN + PROMOTION BACKGROUND CONTROL VERIFIED

NEXT: INVENTORY APP (SEPARATE APPLICATION)

---

## Inventory App — Phase 0 Backend Contracts + Phase 1 Foundation (COMPLETE)

> **Report:** `docs/05-implementation/blynk-inventory-app-report.md` · **Plan:** `docs/superpowers/plans/2026-09-18-blynk-inventory-app.md` (D1–D5 approved)
> **Test Suite:** backend 330 passing · inventory app 55 passing · `tsc` + production build clean
> **Live E2E:** 31/31 checks in real Edge: Admin UI → Inventory UI → customer API → two-operator sourcing race → database truth; deterministic cleanup back to baseline

### Application boundaries
- **Customer App**: separate (Flutter).
- **Admin App**: separate. Products, Categories, Promotions; no Inventory navigation.
- **Inventory App**: current phase, `apps/inventory` (React + Vite + TypeScript, port 5174). Overview · Inventory · Ledger · Sourcing queue · Suppliers.
- **Rider App**: future, separate application.
- One backend, one PostgreSQL. No product copies.

### Phase 0: backend (test-first)
- [x] Stock list starts from products, so Admin-created products with no inventory row appear as UNTRACKED; adds `is_active`/`is_available` (read-only), `search`, `include_inactive`.
- [x] `GET /admin/inventory/adjustments` ledger with product, type, date and page filters, and the actor's name.
- [x] `409 ITEM_ALREADY_SOURCED`: an item is sourced once, including under concurrency.
- [x] D3 manual adjustments: Restock (+), Damage write-off (−), Audit (±), tracked products only (`409 PRODUCT_NOT_TRACKED`).
- [x] `409 SUPPLIER_CODE_TAKEN`; malformed ids return 400, not 500; sourcing items come back in a fixed order.
- [x] Customer payload regression test (no cost, stock or supplier fields). The 28 stray test suppliers were removed transactionally after review.

### Phase 1: Inventory app
- [x] Existing Blynk OTP sign-in; ADMIN and PACKING_STAFF only; automatic refresh; development-only Skip sign-in, absent from production bundles (D5).
- [x] RBAC mirrored in `can()`: staff can view and source; adjust, tracking and supplier changes are ADMIN only. The backend remains authoritative.
- [x] Stock states always shown as a word plus a count; "ORDERABLE BUT OUT OF STOCK" flagged (D1). No checkout reservation.
- [x] Adjustments mirror D3, with a before → after preview and one request per click.
- [x] Ledger in backend order, with filters and pagination.
- [x] Sourcing queue with no customer PII; actual cost shown against the estimate; active suppliers only (D2); `409` shown as "already sourced"; Mark unavailable through the existing resolve-item flow (D4).
- [x] Suppliers: read for staff; add, edit, deactivate and reactivate for admins; no delete.
- [x] Generic-design audit (7 findings) fixed in the visual layer only; tests and live E2E unchanged afterwards.

### Known limitations
- ~~`resolve-item` ownership/state gap~~: fixed in Phase 1.5 (see below).
- Supplier fields can't be cleared through the API; the low-stock threshold can't be edited (G3 deferred).
- Sourcing queue is N+1 and capped at 100 orders per status.
- The live E2E harness lives outside the repo (needs running servers and real OTP codes).

STATUS: INVENTORY APP FOUNDATION COMPLETE AND VERIFIED

NEXT: INVENTORY OPERATIONAL WORKFLOWS / RIDER APP — SEPARATE APPLICATION

---

## Phase 1.5 — Order-Resolution Hardening (COMPLETE)

> **Test Suite:** backend 343 passing (13 new in `tests/order-resolution.test.ts`) · inventory app 58 passing (3 new) · `tsc` + build clean
> **Live E2E:** 34/34 (the 31 Phase 1 checks plus stale-queue "already resolved", a single notification, and a refused cross-order item)

- [x] `POST /admin/orders/:id/resolve-item` and `PATCH /admin/orders/:id/items/:itemId` lock the item (scoped to the order) and then the order, the same lock order as sourcing, and only resolve a PENDING item on a sourceable order.
- [x] Item on another order, or missing: `404 ORDER_ITEM_NOT_FOUND` (reveals nothing about other orders). Sourced or packed: `409 ITEM_ALREADY_SOURCED`. Already resolved: `409 ITEM_ALREADY_RESOLVED`. Cancelled or delivered order: `400 ORDER_NOT_IN_SOURCING_STATE`. Malformed ids or `FULFILLED`: 400, not 500.
- [x] Concurrency: two simultaneous resolves give 200 + 409 with the total reduced once and one notification; a resolve racing a sourcing call has exactly one winner and consistent totals.
- [x] D4 unchanged: item removed, totals and payment recalculated, customer notified.
- [x] Customer order payload no longer includes staff-only `internal_notes`.
- [x] Test hygiene: `inventory.test.ts` and `notifications.test.ts` now delete the orders and addresses they create; a full backend run leaves the database unchanged.

STATUS: INVENTORY ORDER-RESOLUTION HARDENING COMPLETE AND VERIFIED

NEXT: RIDER APP — SEPARATE APPLICATION

---

## Rider App — Foundation (COMPLETE)

> **Report:** [blynk-rider-app-report.md](blynk-rider-app-report.md) · **Plan:** `docs/superpowers/plans/2026-09-18-blynk-rider-app.md` (R1–R13 approved)
> **Test Suite:** backend 381 passing (38 new in `tests/rider-delivery.test.ts`) · rider app 49 passing · admin 15 and inventory 58 unchanged · `tsc` + builds clean
> **Live E2E:** 35/35 (real OTP, real Rider UI in Edge on Pixel 7 emulation, DB checked after every step, baseline restored)

- [x] IMPLEMENTED + TESTED: `apps/rider` (React + Vite, port 5175), a separate app on the existing API. No new backend, database, migration, states, WebSockets, maps or GPS.
- [x] IMPLEMENTED + TESTED: RIDER-only access, an active rider profile required (`RIDER_INACTIVE`), ownership-scoped queries (404 for other riders' deliveries), malformed ids return 400.
- [x] IMPLEMENTED + TESTED: documented transitions enforced server-side under delivery→order row locks. Pickup only from PACKED, arrival only after pickup, FAILED only on the road and with a reason, DELIVERED only via collect-cod, repeats return 409.
- [x] IMPLEMENTED + TESTED: collect-cod is atomic. It checks state, COD method, not-already-paid (409), and the amount against the total read under the lock.
- [x] IMPLEMENTED + TESTED: assign-rider requires a PACKED order and an existing, active rider; duplicate or concurrent assignment returns 409 (was 500).
- [x] IMPLEMENTED + TESTED: customer cancel re-checks under a lock (rule unchanged); a race with pickup has one winner.
- [x] IMPLEMENTED + TESTED: the customer's `delivery` is trimmed to 4 fields, and the rider's failure note no longer reaches the customer's order history.
- [x] MANUALLY VERIFIED: the Customer Flutter app showed the rider-delivered order as Delivered, Rs.610.
- [x] Generic-design audit: 7 findings fixed in the visual layer only; tests and live E2E unchanged afterwards.

### Known limitations
- No dispatch UI (packing and assignment through the admin API only). Customer-unavailable, accept/reject, availability toggle and `/rider/me` are not built.
- `PATCH /admin/orders/:id/status` still ignores the transition matrix (separate phase).
- `tests/notifications.test.ts` leaves 19 order-less notifications unless `orders.test.ts` runs after it (pre-existing, order-dependent).
- Live E2E harness lives outside the repo.

STATUS: RIDER APP FOUNDATION COMPLETE AND VERIFIED

---

## Dispatch & Order Operations Hardening (COMPLETE)

> **Report:** [blynk-dispatch-operations-report.md](blynk-dispatch-operations-report.md) · **Plan:** `docs/superpowers/plans/2026-09-19-blynk-dispatch-order-operations.md` (D1–D15 approved, D6 = B)
> **Test Suite:** backend 629 passing (248 new) · admin 65 (50 new) · inventory 58 · rider 49 · Flutter 188 (4 new) · every `tsc`, build and `flutter analyze` clean
> **Live E2E:** 42/42, run twice (customer → pack → assign → rider → delivered; fail → re-stage → reassign → delivered; hand-over; negative checks), database restored to baseline

- [x] IMPLEMENTED + TESTED: one canonical order lifecycle (`modules/orders/lifecycle/`). Every status change (customer cancel, admin status, pack, assign, rider pickup/arrive/fail/collect, item resolution, re-stage) runs through `runTransition`. A static guard test stops any direct `order_status` write outside it.
- [x] IMPLEMENTED + TESTED: documented transitions with deterministic codes (422 invalid transition, 409 conflict, 403 role, 400 notes/ids), children-before-order locking, and 12 race scenarios run 5× each.
- [x] IMPLEMENTED + TESTED: bypasses closed. The admin status endpoint had no rules; resolve-item could reopen orders already out for delivery; admin cancel skipped the cancellation fields; admin failure blocked reassignment; staff notes leaked into the customer history; malformed ids returned 500.
- [x] IMPLEMENTED + TESTED: a checkout 500 on order-number collisions (pre-existing), fixed with a bounded retry.
- [x] IMPLEMENTED + TESTED: failed-delivery recovery. ADMIN re-stage FAILED/CUSTOMER_UNAVAILABLE → PACKED, then normal reassignment.
- [x] IMPLEMENTED + TESTED: Admin Orders board for PACKING_STAFF (Orders only) and ADMIN. Pack, assign (active riders from `GET /admin/riders`), hand-over, mark delivered/failed/customer unavailable, cancel with a customer-visible reason, re-stage.
- [x] IMPLEMENTED + TESTED + MANUALLY VERIFIED: Customer Orders shows the real item count; tapping a row opens the detail, which shows the status. (Superseded by the "Customer Order Experience" phase below, which replaced this detail screen entirely.)
- [x] Generic-design audit: 7 findings fixed in the visual layer; tests and the live E2E unchanged afterwards.

### Known limitations
- Stock isn't restored on cancellation of TRACKED sourced items (Inventory's domain). There is no "add substitution item" endpoint.
- The board and the Rider app poll rather than receiving push. The order-number date is UTC (pre-existing).
- `tests/notifications.test.ts` leaves 19 order-less notifications unless `orders.test.ts` runs after it (pre-existing).
- The live E2E harness lives outside the repo.

STATUS: DISPATCH & ORDER OPERATIONS HARDENING COMPLETE AND VERIFIED

---

## Inventory & Stock Integrity (COMPLETE)

> **Report:** [blynk-inventory-stock-integrity-report.md](blynk-inventory-stock-integrity-report.md) · **Plan:** `docs/superpowers/plans/2026-09-19-blynk-inventory-stock-integrity.md` (I1–I10 approved; I8 modified: restore only provable values)
> **Test Suite:** backend 696 passing (67 new) via `npm run test:hygiene`, with the database identical after the run · inventory 61 (3 new) · admin 65 · rider 49 · Flutter 188 · every `tsc` and build clean · `flutter analyze`: 2 info lints in untouched sign-in files (see below)
> **Live E2E:** 38/38, then 39/39 (tracked product → source → pack → assign → pickup → delivered; source → cancel → stock returned, by customer and by admin; source → failed → re-stage → replacement rider → delivered; negative checks; ledger chain), every table identical afterwards

- [x] IMPLEMENTED + TESTED: **cancellation returns tracked stock.** It is atomic with the cancel, ledger-backed (`ORDER_CANCELLATION_RESTORE`), order-specific and idempotent. It applies from every state customers or admins may cancel in. Nothing else moves stock after sourcing: pack, dispatch, delivery, failure and re-stage all leave it alone (business rules §6.1).
- [x] IMPLEMENTED + TESTED: **one stock writer** (`inventory/stock-ledger.ts`), with a static guard. Ledger rows are stamped at the moment of movement, so concurrent movements list in order (a deterministic race test reproduced the old ordering bug). The lifecycle catalogue records each action's stock effect.
- [x] IMPLEMENTED + TESTED: 12 inventory races ×5. Lock order extended: item/delivery → order → inventory rows (by id) → payment.
- [x] IMPLEMENTED + TESTED: malformed ids on source, sourcing and supplier routes return 400 (they returned 500). An inactive supplier is refused by name too. Only an admin can create a supplier by naming it during sourcing.
- [x] IMPLEMENTED + TESTED: **test hygiene.** A full backend run leaves every table identical, enforced by `npm run test:hygiene`. Four leaking test files were fixed, including one that renamed an arbitrary real customer on every run.
- [x] One-time conservative repair of historic test pollution. 98 provably test-generated ledger rows were removed, and Munchee was returned to its seed state (UNTRACKED/0). Not provable, so not changed: 15 customer names and 1 unattributed write-off row, recorded in the report.
- [x] Inventory UI: a customer's cancellation shows as "Name · customer" in the ledger, and the tracking dialogs say when stock comes back.

### Known limitations
- **Partial sourcing:** the customer is still billed for the full ordered quantity (pinned by a test, documented). There is no substitution line.
- **Test environment:** the dev API's own notification worker can race `notifications.test.ts` (1 in ~6 runs). Run the suite with the dev API stopped, or with `NOTIFICATION_WORKER_ENABLED=false`.
- **Correction to the Dispatch section above:** `flutter analyze` was not clean. It reports two `use_build_context_synchronously` infos in `otp_verification_screen.dart` and `login_screen_otp_sheet.dart`. Neither file has changed since 2026-09-18 00:37; the fix is one line each, not made here.
- **Harness location:** the live E2E harness lives outside the repo.

STATUS: INVENTORY & STOCK INTEGRITY COMPLETE AND VERIFIED

### Verification hygiene pass (2026-09-19, after the section above)
- `flutter analyze`: the two `use_build_context_synchronously` infos are fixed with `if (!context.mounted) return;` before `Navigator.of(context)` in `otp_verification_screen.dart` and `login_screen_otp_sheet.dart`. The result is now **No issues found**, and behaviour is unchanged.
- **Tests no longer race the development notification worker.**
  - Every backend test run holds a Postgres advisory lock, the outbox pause (`src/modules/notifications/outbox-pause.ts`), for its whole length.
  - The worker's polling loop claims nothing while that lock is held.
  - Direct `processBatch()` calls, which the tests use, are unaffected, and nothing in the application ever takes the lock.
  - Before taking the lock, the run waits for the outbox to go quiet. It refuses to start if messages stay pending.
  - Verified against the live dev worker, and by 3 full runs with it running.
- `npm run test:hygiene` now checksums every row, keyed by primary key, and names each added, removed or changed row. Proven by unit tests and by a deliberate leak, which failed the run.
- Backend 705 passing (9 new).

---

## Customer Order Experience (COMPLETE)

> **Report:** [blynk-customer-orders-report.md](blynk-customer-orders-report.md) · **Plan:** `docs/superpowers/plans/2026-09-19-blynk-customer-order-experience.md`
> **Test Suite:** backend 707 passing (2 new: `can_cancel` contract) · `npm run typecheck` and `npm run test:hygiene` clean ("every row of every table identical") · Flutter 291 passing (from 188 baseline) · `flutter analyze`: clean
> **Live E2E:** normal delivery, cancellation (and a refused stale-state cancel), and failed-delivery recovery (fail → re-stage → replacement rider → delivered), each cross-checked against `GET /orders/:id`, passed twice in a row; dev database restored to baseline both times

- [x] IMPLEMENTED + TESTED: backend gains one additive field, `can_cancel`, on every customer order response — a pure passthrough to the same lifecycle catalogue array (`CATALOGUE.CUSTOMER_CANCEL.from`) the cancel endpoint itself checks under the order lock. No new endpoint, no migration, no change to the cancellation rule or any other module's contract. `POST /orders/:id/cancel` remains the sole authority.
- [x] IMPLEMENTED + TESTED: the Customer app's Orders list and Order detail now show the real backend lifecycle — status, status history (including the `FAILED → PACKED` re-stage row), whether an order is scheduled, the delivery handover status when the backend explicitly reports it, and payment/COD state — instead of inferring anything from the clock or from timestamp columns that go stale after a re-stage.
- [x] IMPLEMENTED + TESTED: cancellation visibility is asked of the backend (`can_cancel`), not derived from a client-side status list; absent ⇒ hidden (fail closed). A refusal from the (still-authoritative) cancel endpoint is shown to the customer and the screen refetches to show the true state.
- [x] IMPLEMENTED + TESTED: rider-assigned/arrived wording is shown only when the backend's `delivery.assignment_status` explicitly says `ASSIGNED`/`ACCEPTED`/`ARRIVED_AT_CUSTOMER` — never inferred from order status or timestamps. No rider identity, phone, location, ETA or map is rendered anywhere (verified by a live forbidden-content scan across every flow).
- [x] IMPLEMENTED + TESTED: the fake "Repeat Order" action was removed, not replaced.
- [x] IMPLEMENTED + TESTED: the Orders list and Order detail now agree on staleness handling — both refetch on pull-to-refresh, on returning to the foreground, and after a cancel attempt (approved decision C6); both show a visible notice rather than silently discarding a failed refresh when content is already on screen.
- [x] Generic-design audit: 10 findings fixed in the visual layer only (Catamaran on button/snackbar text that was silently falling back to the platform font; the bill's Total made unmistakable; the status timeline given per-status colour and a visible rail; page-background text/icon contrast raised to WCAG AA; card differentiation; the scheduled-delivery pill given a visible fill; the order list reworked so status+total lead and closed orders recede; empty/error states optically centred; the confirmation screen's amount and schedule made dominant; the cancellation sheet given a drag handle and more separation). Tests and the live E2E re-verified clean afterwards.

### Known limitations
- The Android release build is blocked by a pre-existing Gradle 7.5 / Java 21 toolchain mismatch on this machine (no compatible JDK found); confirmed unrelated to this phase's code. A Windows release build was used as the production-build check instead; an Android smoke build is recommended once a matching JDK is available, since this phase added font-style and icon references that only an Android release build's tree-shaking exercises.
- The button/snackbar typography fix (adding `fontFamily: 'Catamaran'` to four shared `ButtonStyle`/`SnackBarTheme` text styles, which were silently rendering in the platform font because `ButtonStyle.textStyle` replaces rather than merges with the ambient theme) is app-wide by necessity — every Customer-app screen's call-to-action text changes typeface, not just the Orders screens.
- `refresh_tokens` in the dev database gained rows from the live E2E harness's own long-lived store-side sessions (kept deliberately so the seeded ops accounts stay signed in); not part of the strict baseline set, considered advisory.
- The live E2E harness lives outside the repo, per the existing convention.
- Minor, deferred (not fixed this phase): a small colour-token fork between the list chip and the detail header for the same status tone (both independently WCAG-valid); `paymentLine` has an unreachable-today branch gap for a `REFUNDED` payment status; two Key-naming conventions diverge slightly between the list and detail screens' retry/refresh-failed notices.

STATUS: CUSTOMER ORDER EXPERIENCE COMPLETE AND VERIFIED
