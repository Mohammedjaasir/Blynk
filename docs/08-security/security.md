# Blynk Backend — Security Documentation

> **Version:** Stage 9 — Security Hardening & Abuse Protection  
> **Last Updated:** 2026-09-16  
> **Scope:** Phase 1 — Single-instance modular monolith, Dharga Town, Sri Lanka

---

## 1. Threat Model

### System Profile
Blynk is a Quick-Commerce backend serving a small-town (Dharga Town) delivery market. Phase 1 uses a single-instance modular monolith. The attack surface is a JSON REST API over HTTPS, backed by PostgreSQL.

### Threat Actors

| Actor | Capability | Risk Level |
|---|---|---|
| A. Anonymous attacker | No token, unknown origin | High |
| B. Normal CUSTOMER | Valid token, CUSTOMER role | Medium |
| C. RIDER attempting ADMIN | Valid RIDER token | Medium |
| D. PACKING_STAFF attempting ADMIN-only | Valid staff token | Low-Medium |
| E. CUSTOMER A → CUSTOMER B resources | Valid token, wrong owner | High (IDOR) |
| F. RIDER A → RIDER B delivery | Valid token, wrong rider | Medium (IDOR) |
| G. Compromised customer account | Stolen JWT | Medium |
| H. Compromised rider account | Stolen JWT | Medium |
| I. Malicious admin | Valid ADMIN token | Low (internal) |
| J. Automated OTP abuse | Scripted requests, spoofed IPs | High |
| K. API scraping/abuse | Unauthenticated enumeration | Medium |
| L. Order-price manipulation | Malicious checkout payload | High |
| M. Inventory manipulation | Fake stock adjustments | Medium |
| N. Notification abuse | Arbitrary SMS trigger | Medium |

### Out of Scope (Phase 1)
- DDoS mitigation infrastructure
- Network-level attacks (WAF, CDN)
- Payment gateway fraud (COD-only in Phase 1)
- Physical store security
- Mobile app reverse engineering

---

## 2. Trust Boundaries

`
Internet
  │  HTTPS (TLS enforced at reverse proxy)
  ▼
[ Express API ]
  │  requireAuth (JWT verification)
  │  requireRoles (RBAC)
  │  validate (Zod schema)
  ▼
[ Business Service Layer ]
  │  Ownership/IDOR checks (customer_id scope)
  │  Authoritative pricing (server-computed)
  ▼
[ Kysely Query Builder ]
  │  Parameterized queries only
  │  Typed Database schema
  ▼
[ PostgreSQL ]
  │  Database constraints
  │  CHECK constraints, FKs, partial unique indexes
  │  Transaction isolation
`

**Never trusted from client:**
- Prices, costs, markup, delivery fee
- Order status, payment status
- Role, user ID
- Inventory quantities
- Supplier selection
- OTP (only submitted for server-side bcrypt comparison)

---

## 3. Authentication

### OTP Authentication
- OTP generation: crypto.randomInt(100000, 999999) — cryptographically secure PRNG
- OTP storage: crypt hash (10 rounds) — never stored plaintext
- OTP lifetime: 5 minutes (configurable via OTP_EXPIRY_MINUTES)
- Max attempts: 3 per challenge (configurable via OTP_MAX_ATTEMPTS)
- Prior challenge invalidation: atomic transaction invalidates old challenges on new request
- Successful verification: OTP consumed atomically via SELECT FOR UPDATE
- Replay prevention: row-level lock on consumption, consumed_at checked post-lock

### JWT Access Tokens
- Algorithm: HS256 — enforced on verification (lgorithms: ['HS256'])
- lg:none attacks: prevented by lgorithms allowlist in jwt.verify()
- Expiry: 15 minutes (configurable via JWT_ACCESS_EXPIRY)
- Claims: sub (user ID), phone, ole — all required and validated on decode
- Secret: never logged, never returned in API responses

### Refresh Tokens
- Generation: crypto.randomBytes(40).toString('hex') — 80-char hex, 320 bits entropy
- Storage: SHA-256 digest stored in DB — raw token never persisted
- Lifetime: 30 days
- Single-use rotation: token revoked on use, new token issued
- Replay detection: reuse of a revoked token triggers **immediate revocation of all user sessions**
- Transaction safety: SELECT FOR UPDATE prevents concurrent rotation race conditions

### Logout
- Named token logout: specific session revoked via token hash
- Logout-all: revokes all refresh tokens for the user

---

## 4. Authorization (RBAC)

### Roles
| Role | Description |
|---|---|
| CUSTOMER | Regular customer — orders, addresses, own profile |
| RIDER | Delivery rider — own assigned deliveries |
| PACKING_STAFF | Store operations — packing queue, sourcing |
| ADMIN | Full access — catalog management, inventory, analytics |

### Enforcement
- equireAuth middleware: validates JWT, attaches eq.user
- equireRoles(...) middleware: checks eq.user.role against allowlist
- Dual guard on all protected routes: authentication is always checked first

### Role Boundary Matrix
| Endpoint Category | CUSTOMER | RIDER | PACKING_STAFF | ADMIN |
|---|---|---|---|---|
| Auth endpoints | ✅ | ✅ | ✅ | ✅ |
| Own profile/address | ✅ | ✅ | ✅ | ✅ |
| Own orders | ✅ | ❌ | ❌ | ✅ |
| Rider deliveries | ❌ | ✅ (own) | ❌ | ✅ |
| Packing queue | ❌ | ❌ | ✅ | ✅ |
| Admin orders/status | ❌ | ❌ | ✅ | ✅ |
| Rider assignment | ❌ | ❌ | ❌ | ✅ |
| Inventory management | ❌ | ❌ | ✅ (read) | ✅ |
| Inventory adjustment | ❌ | ❌ | ❌ | ✅ |
| Supplier management | ❌ | ❌ | ✅ (read) | ✅ |
| Catalog management | ❌ | ❌ | ❌ | ✅ |
| Operations metrics | ❌ | ❌ | ❌ | ✅ |
| Notification queue | ❌ | ❌ | ❌ | ✅ |

---

## 5. IDOR Prevention

### Customer Resource Scoping
All customer-facing queries scope by the authenticated customer_id from the JWT:

- GET /orders/:id — indOrderById(orderId, customerId) — customer_id scoped
- GET /orders — indCustomerOrders(customerId, ...) — customer_id scoped
- POST /orders/:id/cancel — indOrderById(orderId, customerId) — ownership verified
- GET /me/addresses — listAddresses(userId) — user_id scoped
- GET /me/addresses/:id — indAddressById(addressId, userId) — user_id scoped
- PATCH /me/addresses/:id — updateAddress(addressId, userId, ...) — ownership verified
- DELETE /me/addresses/:id — deleteAddress(addressId, userId) — ownership verified

**UUIDs are not authorization.** Even if a client guesses another customer's UUID, the repository query will return 404 because the user_id in the WHERE clause does not match.

### Rider Resource Scoping
All rider delivery operations resolve the ider_id from the iders table using eq.user.id (not from client input):
- getActiveDeliveries(userId) → indRiderByUserId(userId) → indActiveDeliveries(rider.id)
- getDeliveryById(deliveryId, userId) → scoped to ider.id
- updateDeliveryStatus(deliveryId, userId, ...) → scoped to ider.id
- collectCod(deliveryId, userId, ...) → scoped to ider.id

Rider A cannot access Rider B's delivery because the query is always scoped to the rider profile linked to the JWT subject.

### Address Ownership in Checkout
Checkout validates address ownership before computing pricing:
`
findCustomerAddress(customerId, input.address_id)
→ WHERE id = ? AND user_id = ? AND is_deleted = false
`
A customer cannot use another customer's address for delivery.

---

## 6. Rate Limiting

### Current Implementation
In-memory sliding window rate limiter (InMemoryRateLimiter) — appropriate for Phase 1 single-instance architecture.

| Limit | Window | Target |
|---|---|---|
| Max 3 OTP requests | per hour | per phone number |
| Max 15 OTP requests | per 15 minutes | per IP address |

### Notes
- The in-memory limiter **does not persist across process restarts**.
- In a multi-instance deployment, a shared rate-limit store (e.g., Redis) would be required to prevent bypass by routing requests to different instances.
- This is a **known Phase 1 limitation** — acceptable for single-instance deployment.

---

## 7. Input Validation

All externally supplied input is validated through **Zod schemas** before reaching service or database layers.

### Validation Coverage

| Input | Schema | Constraints |
|---|---|---|
| Phone number | equestOtpSchema | Sri Lankan E.164, 
ormalizeSriLankanPhone() |
| OTP code | erifyOtpSchema | 6 digits, numeric only |
| Refresh token | efreshTokenSchema | min 32, max 256 chars |
| Checkout address | createOrderSchema | UUID |
| Checkout items | createOrderSchema | 1–50 items, quantity 1–100 |
| Order notes | createOrderSchema | max 500 chars |
| Idempotency key | createOrderSchema | max 128 chars |
| Admin order status | dminUpdateOrderStatusSchema | enum allowlist |
| Admin rider ID | dminAssignRiderSchema | UUID |
| Admin pagination | dminOrderQuerySchema | page ≥ 1, limit 1–100 |
| Delivery status | updateDeliveryStatusSchema | enum allowlist |
| COD amount | collectCodSchema | non-negative, finite, max 1,000,000 LKR |
| Item resolution | esolveItemSchema | enum allowlist, optional UUID |
| Address fields | createAddressSchema | lat -90/90, lng -180/180, string lengths |
| Profile update | updateProfileSchema | name ≤ 128, email validated |
| Product name, SKU | createProductSchema | lengths bounded |
| Purchase cost | createProductSchema | min 0 (non-negative) |
| Markup | createProductSchema | 0–1000% |
| Inventory delta | djustStockSchema | non-zero integer |
| Supplier fields | createSupplierSchema | bounded lengths |
| Search terms | productQuerySchema | max 100 chars |
| Catalog pagination | productQuerySchema | limit 1–100 |

### JSON Body Size
Request body is limited to **1MB** (express.json({ limit: '1mb' })). Oversized payloads receive HTTP 413.

---

## 8. Price Integrity

### Server-Authoritative Pricing
All selling prices are computed server-side using the canonical formula:
`
selling_price = purchase_cost × (1 + effective_markup / 100)
`
Where effective_markup = product-specific markup if set, else the store-wide default markup (20%).

**The client cannot influence:**
- purchase_cost — read from products table
- custom_markup_percent — read from products table
- default_markup — read from system_configurations
- delivery_fee — read from system_configurations
- unit_selling_price — computed server-side
- subtotal_amount — server-computed sum
- 	otal_amount — subtotal + delivery_fee, server-computed

Even if a client submits { "unit_selling_price": 0, "delivery_fee": 0, "total": 1 }, Zod strips all unknown fields — the createOrderSchema only accepts ddress_id, items, customer_notes, and idempotency_key.

### Order Price Immutability
Order item pricing snapshots (unit_selling_price, estimated_unit_cost, markup_percentage_applied) are written once at order creation and are never updated by normal operations. The only permitted modification is the esolveUnavailableItem workflow (ADMIN/PACKING_STAFF only).

---

## 9. Order Lifecycle Security

### State Machine
`
PLACED → PACKED → OUT_FOR_DELIVERY → DELIVERED
                                   ↘ CUSTOMER_UNAVAILABLE
       ↘ CANCELLED                 ↘ FAILED
ITEM_UNAVAILABLE (can be resolved to CANCELLED or continued)
`

### Customer Restrictions
Customers may cancel orders only in PLACED or PACKED states. They cannot directly set DELIVERED, OUT_FOR_DELIVERY, PACKED, FAILED.

### Admin Status Updates
Admin can transition orders but is now restricted to the canonical enum via dminUpdateOrderStatusSchema. Invalid status strings return HTTP 400.

### Rider Restrictions
Riders may only set: ACCEPTED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED, CUSTOMER_UNAVAILABLE. They cannot set CANCELLED or FAILED directly. The updateDeliveryStatusSchema enforces this enum at the HTTP layer.

---

## 10. Inventory Security

- All inventory adjustment endpoints require ADMIN role
- Tracking mode changes (ADMIN only)
- Sourcing/packing operations: ADMIN or PACKING_STAFF
- CUSTOMER and RIDER cannot access any inventory endpoint (403)
- Negative stock: enforced by PostgreSQL CHECK (quantity_on_hand >= 0) constraint
- Inventory delta of 0: rejected by djustStockSchema (efine val !== 0)

---

## 11. Supplier Security

| Operation | Required Role |
|---|---|
| List suppliers | ADMIN, PACKING_STAFF |
| Get supplier by ID | ADMIN, PACKING_STAFF |
| Create supplier | ADMIN only |
| Update supplier | ADMIN only |

Supplier creation and update are validated by createSupplierSchema / updateSupplierSchema — all fields are bounded strings.

---

## 12. Notification Security

- Notification enqueuing is internal — triggered by business events (order creation, etc.)
- No public endpoint exists to submit arbitrary notifications
- Admin /notifications read-only endpoint returns queue metrics — no payload mutation
- Notification worker is the **only trusted dispatch path**
- Provider credentials (SMS_API_KEY, SMS_USER_ID) are environment variables — never logged or returned
- Notification recipients come from verified order data — not from client input at dispatch time
- Notification status cannot be manually set to SENT or DELIVERED via API

---

## 13. Admin Security

- Every admin endpoint requires both equireAuth AND equireRoles('ADMIN') or equireRoles(['ADMIN', 'PACKING_STAFF'])
- Admin operations metrics (/admin/operations/metrics, /admin/operations/status) are ADMIN only
- Input validation applied to all admin mutations using Zod schemas
- Admin catalog management (categories, products) uses equireRoles('ADMIN')
- There are no accidental customer-accessible admin routes — admin endpoints are prefixed /api/v1/admin/

---

## 14. Database Security

### Parameterized Queries
All queries use the Kysely query builder with typed schemas. No string interpolation into SQL. No sql.lit() usage. No Kysely<any> usage. No JSONPathBuilder.key()/.at() usage. (All three are the attack surfaces for the Kysely CVEs in the dependency audit — none are present in this codebase.)

### Database Constraints
| Constraint | Purpose |
|---|---|
| CHECK (quantity_on_hand >= 0) | Prevents negative inventory |
| UNIQUE (order_id, product_id) | Prevents duplicate order items |
| UNIQUE (idempotency_key) | Ensures checkout idempotency |
| UNIQUE (token_hash) | Ensures refresh token uniqueness |
| Partial unique index uq_deliveries_active_assignment | Prevents double-assignment |
| Foreign keys | Referential integrity across all tables |

### Transaction Safety
- OTP challenge consumption: SELECT FOR UPDATE inside transaction
- Refresh token rotation: SELECT FOR UPDATE inside transaction
- Order creation: atomic transaction (order + items + payment + notification)
- COD settlement: atomic INSERT INTO cod_settlements + delivery update

---

## 15. Sensitive Data Handling

### Never Logged
- OTP plaintext (only logged in dev/test as dev_otp)
- Access tokens
- Refresh tokens
- Authorization header
- Password/OTP hashes
- API keys
- Provider credentials

### Pino Redaction List
`
req.headers.authorization, req.headers.cookie, req.body.otp, req.body.code,
req.body.password, user.phone, user.email, phone, email, password, token,
accessToken, refreshToken, otp_hash, token_hash
`

### Customer Response Sanitization
Order responses to customers strip internal cost data:
- estimated_unit_cost → removed
- ctual_unit_cost → removed
- markup_percentage_applied → removed

These fields are visible only in admin-scoped responses.

### Error Responses
- 500 errors: masked to generic "An unexpected internal server error occurred" in client response
- 4xx errors: descriptive message exposed as intended by API contract
- Stack traces: only in response body during NODE_ENV=development
- SQL errors, DB connection strings, filesystem paths: never included in client responses

---

## 16. Security Logging

Security events logged (without PII):
| Event | Log Level | Fields Logged |
|---|---|---|
| OTP challenge issued | info | phone (partially masked by redact) |
| Refresh token replay detected | warn | userId, tokenId |
| Invalid token use | Error via middleware | requestId, URL, method |
| Rate limit exceeded | Error response to client | No internal details exposed |
| Account deactivated login attempt | Auth error | Captured in error middleware |

---

## 17. HTTP Security

### Helmet Configuration
Helmet is active on all requests with default security headers:
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- X-DNS-Prefetch-Control: off
- Referrer-Policy: no-referrer

CSP is disabled in development for ease of local testing. Production uses Helmet defaults (CSP enabled).

### CORS
- Development: configured origins from CORS_ORIGINS env variable
- Production: CORS_ORIGINS=* is explicitly blocked by env.ts production guard
- Methods: GET, POST, PATCH, DELETE, OPTIONS
- Access-Control-Allow-Credentials not set (no cookie-based auth)

### Request Size Limits
- JSON body: **1MB** (express.json({ limit: '1mb' }))
- URL-encoded: **1MB** (express.urlencoded({ limit: '1mb' }))
- Oversized bodies: HTTP 413

---

## 18. Dependency Security

### npm audit Results (Stage 9)

| Package | Severity | Advisory | Exploitable in Blynk? | Action |
|---|---|---|---|---|
| itest / @vitest/mocker | Moderate | Path traversal via redirect mock (GHSA-82fw-gwwq-j7x9) | **No** — dev/test tool only, not in production | No action — dev dependency |
| kysely ≤ 0.28.16 | High | SQL injection via sql.lit() / Kysely<any> / JSONPathBuilder | **No** — Blynk uses none of these APIs | No action — unaffected usage |

#### Kysely Vulnerability Assessment

The reported Kysely CVEs require one of:
1. sql.lit(userInput) — not used in Blynk (grep confirms: no sql.lit anywhere)
2. Kysely<any> untyped instance — not used (grep confirms: no Kysely<any>)
3. JSONPathBuilder.key(userInput) / .at(userInput) — not used (no JSON path traversal in Blynk queries)

Upgrading to  .28.17 requires breaking API changes. **Not applied** — the vulnerability is not reachable in this codebase. If Kysely usage ever adds sql.lit() or JSON path queries with user input, upgrade must be applied immediately.

---

## 19. Known Limitations

1. **In-memory rate limiting** — resets on process restart; multi-instance deployment requires shared rate-limit state (e.g., Redis)
2. **No account lockout** — no mechanism to permanently lock an account after repeated failures (OTP challenges expire and require re-request)
3. **No IP-based blocking** — individual IPs cannot be banned at application level; requires WAF/reverse proxy
4. **Access token revocation** — JWTs cannot be revoked before expiry (15-minute window); only refresh tokens can be revoked
5. **Single-instance session management** — refresh token sessions are not replicated; multi-instance deployment would require shared session store
6. **No HTTPS enforcement** — TLS must be enforced at the reverse proxy/load balancer level; the application does not redirect HTTP→HTTPS
7. **Rider status transitions** — the updateDeliveryStatus enum allowlist is enforced at schema level; deeper business-rule transition validation (e.g., must be ACCEPTED before PICKED_UP) is handled in the repository layer

---

## 20. Recommended Future Security Work

1. **Refresh token revocation on password change** — if admin resets a user's account, all sessions should be invalidated
2. **Redis-backed rate limiting** — for multi-instance deployment
3. **Short JWT access token + server-side session** — for immediate revocation capability without waiting for 15-minute expiry
4. **Security event metrics** — instrument failed auth attempts, rate-limit hits, IDOR attempts into the Stage 8 metrics system
5. **Automated secrets scanning** — integrate 	ruffleHog or gitleaks into CI pipeline
6. **HTTPS enforcement middleware** — add express-sslify or proxy-based X-Forwarded-Proto check in production
7. **CSP policy tuning** — define a strict Content-Security-Policy for any future browser-facing endpoints
8. **Dependency auto-update** — configure Dependabot or Renovate for automated dependency security updates
