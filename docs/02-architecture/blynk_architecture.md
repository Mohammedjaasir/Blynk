# Blynk — Production-Ready Technical Architecture & Implementation Plan
### Phase 1: Dharga Town Launch

---

## 1. Executive Architecture Summary

Blynk is a quick-commerce grocery delivery platform launching in Dharga Town, Sri Lanka. Phase 1 operates one centrally-located dark store, serves a 4 km delivery radius, supports ~50 orders/day with 1–2 riders, and accepts only Cash on Delivery.

The architectural philosophy is **"Simple Now, Scalable Later"**:

- **Modular monolith** backend (not microservices) — easy to operate, deploy, and reason about at 50 orders/day
- **Single PostgreSQL database** — sufficient for Phase 1 volume, schema designed to scale multi-store, multi-city
- **Native Android app (React Native)** — required for Phase 1; full Play Store distribution
- **Web/PWA (Next.js)** — first-class iOS fallback and universal web access; all customer features available
- **iOS App Store app** — pursued in parallel using the same React Native codebase; Web/PWA is the guaranteed fallback if App Store approval fails or is delayed
- **Same REST API** consumed by all clients (Android app, iOS app, Web/PWA, rider app, admin dashboard)
- **No business logic duplication** — Android and Web/PWA share API client, TypeScript types, and validation logic; only UI differs
- **No Kubernetes, no Kafka, no microservices, no Redis** in Phase 1
- **Cloud-hosted** on a single VPS (DigitalOcean/Hetzner) with managed PostgreSQL

**Phase 2** (Beruwala expansion): add a second dark store, second service area, and optionally a second backend instance behind a load balancer. Zero schema redesign required.

---

## 2. Recommended Technology Stack

| Layer | Technology | Why Blynk? |
|---|---|---|
| **Android Customer App** | React Native (TypeScript) | Required native Android app; same codebase reused for iOS App Store submission |
| **iOS Customer App** | React Native (same codebase as Android) | Submitted to App Store in parallel; no extra development cost |
| **Web/PWA (iOS fallback + universal)** | Next.js 14 (App Router) + next-pwa | First-class iOS fallback; installable on iPhone home screen via Safari; also serves desktop/web customers |
| **Admin Dashboard** | Next.js (same monorepo) | Shared API client and types; same API |
| **Rider App** | Next.js PWA (mobile-first) | Works on any smartphone browser; no app store submission needed for riders |
| **Shared Logic Layer** | TypeScript package (monorepo) | API client, types, validation, business rules — shared between Android/iOS and Web/PWA |
| **Backend** | Node.js + Express (TypeScript) — Modular Monolith | Fast dev, large ecosystem, excellent for I/O-heavy workloads |
| **Database** | PostgreSQL 16 (managed) | Relational, ACID, excellent for transactional commerce |
| **ORM** | Prisma | Type-safe, migration support, schema-first |
| **Auth** | JWT (access + refresh tokens) + OTP via SMS | Stateless, scalable; no session store needed in Phase 1 |
| **SMS** | Twilio / Dialog Axiata SMS API | OTP + order notifications |
| **WhatsApp** | Twilio WhatsApp API / 360dialog | Order status updates |
| **Push Notifications (Android)** | Firebase Cloud Messaging (FCM) | Native push for React Native Android app |
| **Push Notifications (Web/iOS PWA)** | Web Push API | Supported on iOS 16.4+ Safari and all modern browsers |
| **Image Storage** | Cloudflare R2 (S3-compatible) | Cheap, no egress fees, CDN integration |
| **CDN** | Cloudflare (free tier sufficient for Phase 1) | Global CDN, DDoS protection, free SSL |
| **Background Jobs** | node-cron + BullMQ (Redis-optional) | Scheduled tasks; BullMQ added in Phase 2 if needed |
| **Hosting** | DigitalOcean Droplet (2 vCPU / 4 GB RAM) | ~$24/mo, simple, reliable |
| **Managed DB** | DigitalOcean Managed PostgreSQL | Automatic backups, failover |
| **CI/CD** | GitHub Actions | Free for public/small repos |
| **Monitoring** | Sentry (errors) + Grafana Cloud free tier | Application errors + basic metrics |
| **Logging** | Winston + Logtail (Better Stack free tier) | Structured logs, searchable |
| **Process Manager** | PM2 | Zero-downtime restarts, cluster mode |
| **Reverse Proxy** | Nginx | SSL termination, rate limiting, static file serving |
| **SSL** | Let's Encrypt via Certbot (free) | HTTPS |

---

## 3. Platform Strategy: Native Android + React Native iOS + Next.js Web/PWA

### Confirmed Requirements

| Platform | Requirement | Delivery |
|---|---|---|
| **Android** | Native app — **REQUIRED** for Phase 1 | React Native → Google Play Store |
| **iOS** | App Store app **preferred**, but NOT required | React Native (same codebase) → App Store submission |
| **iOS Fallback** | **GUARANTEED** — if App Store fails/delays | Next.js Web/PWA (installable via Safari) |
| **Web/PWA** | First-class interface, not afterthought | Next.js 14 + next-pwa, ALL features present |
| **Rider App** | Internal tool, no app store needed | Next.js PWA (mobile-first) |
| **Admin** | Internal tool, desktop-first | Next.js dashboard |

### Recommended Architecture: React Native + Next.js Monorepo

```
 blynk-monorepo/
 ├── apps/
 │   ├── android/          React Native (Android primary target)
 │   ├── ios/              React Native (same code, iOS build target)
 │   ├── web/              Next.js 14 PWA (iOS fallback + universal web)
 │   ├── rider/            Next.js PWA (mobile-first, no store needed)
 │   └── admin/            Next.js dashboard
 ├── packages/
 │   ├── api-client/       Shared HTTP client (same API calls on all platforms)
 │   ├── types/            Shared TypeScript types (Order, Product, Cart...)
 │   ├── validation/       Shared validation logic (phone, address, cart rules)
 │   └── constants/        Shared constants (order statuses, error codes)
 └── backend/              Node.js + Express + Prisma
```

**What is shared between Android/iOS and Web:**
- `packages/api-client` — all API calls, identical behavior
- `packages/types` — Order, Product, Cart, User, Address interfaces
- `packages/validation` — phone number validation, cart quantity rules, etc.
- `packages/constants` — status codes, error messages, config
- Backend REST API — identical endpoints, auth, business rules

**What is NOT shared (intentionally separate):**
- UI components — React Native uses `<View>/<Text>/<TouchableOpacity>`; Next.js uses `<div>/<p>/<button>`
- Navigation — React Navigation (RN) vs Next.js App Router (web)
- Push notifications — FCM (RN Android) vs Web Push API (web/PWA)
- Local storage — AsyncStorage (RN) vs localStorage/cookies (web)

### Evaluation Matrix (Updated)

| Criteria | Kotlin Native + Next.js | Flutter | **React Native + Next.js** | Pure Next.js PWA |
|---|---|---|---|---|
| Android native experience | ✅ Best | ✅ Good | **✅ Very Good** | ❌ Web only |
| iOS App Store path | Separate codebase | Same code | **Same code as Android** | PWA only |
| iOS PWA fallback | ✅ | Limited | **✅ Via Next.js** | ✅ |
| Shared logic (Android ↔ Web) | Partial (API only) | Complex | **✅ packages/** | N/A |
| Dev speed | Slowest (2 native codebases) | Medium | **Fast** | Fastest |
| Maintenance cost | High | Medium | **Low-Medium** | Low |
| Push notifications | FCM + Web Push | FCM + limited web | **FCM (RN) + Web Push (PWA)** | Web Push only |
| Play Store distribution | ✅ | ✅ | **✅** | Limited (TWA) |
| App Store distribution | ✅ | ✅ | **✅** | No |
| No App Store launch possible | ❌ Android only | ❌ Android only | **✅ Web/PWA covers iOS** | ✅ |
| Offline capability | Full | Full | **Full (RN) + SW (web)** | Service Worker |

### Why React Native + Next.js (not Flutter)

1. **Flutter web is unsuitable for production PWA**: Poor SEO, large bundle size (~5 MB initial load), limited Web Push support. The existing Blynk Flutter repo already shows this — `flutter_cached_pdfview` and `flutter_secure_storage` have known web incompatibilities.
2. **React Native shares TypeScript** with Next.js — one language, one `packages/` layer, consistent developer experience across all platforms.
3. **React Native's web story is clean**: The business logic packages are plain TypeScript. Adding a new platform (web, TV, desktop) is adding a new app, not rewriting logic.
4. **Next.js PWA is production-grade** for e-commerce — used by major grocery and retail platforms. Superior to Flutter web for SEO, performance, and browser compatibility.
5. **iOS risk is fully mitigated**: App Store review can take days to weeks, or be rejected. With this architecture, iOS customers are fully served by the Next.js PWA from day one, in parallel with the App Store submission process.

### iOS Strategy in Detail

```
Day 1 — Launch:
  Android customers → React Native app (Play Store)
  iOS customers     → Next.js Web/PWA (blynk.lk, installable via Safari)
  Web customers     → Next.js Web/PWA

In parallel (App Store submission process):
  Same React Native codebase → iOS build → App Store review
  Timeline: 1–4 weeks typical review time

If App Store APPROVED:
  iOS customers can choose: App Store app OR continue using Web/PWA
  Both work identically (same backend API)

If App Store REJECTED or DELAYED:
  iOS customers: Web/PWA continues to work without interruption
  No customer impact whatsoever
  No architecture change required
```

### iOS PWA Capabilities (Safari, iOS 16.4+)

| Feature | iOS PWA Support |
|---|---|
| Installable to home screen | ✅ "Add to Home Screen" |
| Full-screen app experience | ✅ `display: standalone` |
| Web Push notifications | ✅ iOS 16.4+ |
| OTP / SMS login | ✅ |
| Product browsing | ✅ |
| Cart + checkout | ✅ |
| COD orders | ✅ |
| Order tracking | ✅ (polling) |
| Address + location | ✅ Geolocation API |
| Offline catalog cache | ✅ Service Worker |
| Camera (future features) | ✅ `<input type=file capture>` |

> **Conclusion:** iOS PWA covers 100% of Phase 1 customer requirements.

---

## 4. High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          CUSTOMER TOUCHPOINTS                                │
│                                                                              │
│  ┌─────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐  │
│  │  Android App    │   │   iOS App Store App       │   │  Web / PWA       │  │
│  │  (React Native) │   │   (React Native, same     │   │  (Next.js 14)    │  │
│  │  ✅ REQUIRED     │   │    codebase as Android)   │   │  ✅ GUARANTEED   │  │
│  │  Google Play    │   │   Preferred, not required │   │  iOS fallback    │  │
│  └────────┬────────┘   └────────────┬──────────────┘   └────────┬─────────┘  │
│           │                         │     IF App Store fails:    │            │
│           │                         │     iOS users use Web/PWA ─┘            │
│           └─────────────────────────┴───────────────────────────┘            │
│                                     │                                        │
│           ┌─────────────────────────┤                                        │
│           │  packages/ (shared TS)  │ api-client, types, validation          │
│           └─────────────────────────┘                                        │
└─────────────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS REST API
┌────────────────────────────▼────────────────────────────────────────────┐
│                     BLYNK BACKEND (Modular Monolith)                    │
│                         Node.js + Express + TS                          │
│                                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Auth    │ │ Products │ │  Orders  │ │ Delivery │ │Notification│  │
│  │  Module  │ │ Catalog  │ │  Module  │ │  Module  │ │   Module   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │  Cart    │ │Inventory │ │ Payments │ │  Admin   │                 │
│  │  Module  │ │  Module  │ │  Module  │ │  Module  │                 │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                 │
│                                                                         │
│            Background Jobs (node-cron / BullMQ Phase 2)                │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
┌─────────▼──────┐  ┌────────▼───────┐  ┌───────▼────────┐
│  PostgreSQL 16  │  │  Cloudflare R2 │  │  External APIs  │
│  (Managed DB)  │  │  (Images/Files)│  │ Twilio SMS/WA   │
└────────────────┘  └────────────────┘  └────────────────┘

┌──────────────────┐   ┌──────────────────┐
│   Rider App PWA  │   │  Admin Dashboard │
│  (Mobile-first   │   │  (Next.js)       │
│   Next.js PWA)   │   │                  │
└────────┬─────────┘   └────────┬─────────┘
         └──────────────────────┘
                    │ HTTPS REST API (same backend)
```

---

## 5. Detailed Component Architecture

### A. Frontend Architecture

**Structure: Monorepo — React Native (Android/iOS) + Next.js (Web/PWA/Admin/Rider)**

```
blynk-monorepo/
├── apps/
│   ├── mobile/            # React Native — Android (required) + iOS (App Store submission)
│   │   ├── android/       # Android-specific config, signing, build.gradle
│   │   ├── ios/           # iOS-specific config, Xcode project
│   │   └── src/
│   │       ├── screens/   # Login, Home, ProductList, Cart, Checkout, Orders, Profile
│   │       ├── navigation/ # React Navigation stack/tab navigator
│   │       ├── components/ # Native UI components (View, Text, TouchableOpacity)
│   │       ├── hooks/     # useCart, useOrders, useAuth (uses packages/api-client)
│   │       └── notifications/ # FCM setup (Android push)
│   │
│   ├── web/               # Next.js 14 — Web/PWA (iOS fallback + universal)
│   │   ├── app/           # App Router pages
│   │   │   ├── (auth)/    # Login, OTP verification
│   │   │   ├── (shop)/    # Home, categories, products, search
│   │   │   ├── cart/      # Cart page
│   │   │   ├── checkout/  # Checkout + address
│   │   │   ├── orders/    # Order history + tracking
│   │   │   └── profile/   # User profile, addresses
│   │   ├── components/    # Web UI components (div, button, input)
│   │   ├── public/
│   │   │   ├── manifest.json   # PWA manifest (installable on iOS/Android)
│   │   │   └── sw.js           # Service worker (offline, push)
│   │   └── next.config.js      # next-pwa config
│   │
│   ├── rider/             # Next.js PWA — Rider app (mobile-first, no store needed)
│   └── admin/             # Next.js — Admin dashboard (desktop-first)
│
├── packages/
│   ├── api-client/        # Shared API calls — used by mobile AND web
│   │   ├── auth.ts        # OTP request/verify, refresh token
│   │   ├── products.ts    # Catalog, search, categories
│   │   ├── cart.ts        # Cart CRUD
│   │   ├── orders.ts      # Place order, cancel, history, track
│   │   └── addresses.ts   # Address management, delivery area check
│   ├── types/             # Shared TypeScript interfaces
│   │   └── index.ts       # User, Product, Order, Cart, Address, Delivery...
│   ├── validation/        # Shared business rules
│   │   └── index.ts       # Phone validation, cart rules, order eligibility
│   └── constants/         # Shared constants
│       └── index.ts       # ORDER_STATUSES, ERROR_CODES, DELIVERY_FEE
│
└── backend/               # Node.js + Express + Prisma
```

---

**Android Native App (React Native) — Required for Phase 1:**
- Full native Android experience (smooth scrolling, native gestures, system fonts)
- OTP login via SMS (react-native-otp-verify for auto-read on Android)
- Product browsing, search, category navigation
- Cart management (AsyncStorage + server-synced)
- Delivery address with GPS (react-native-geolocation-service)
- COD checkout, order placement
- Order history + real-time status (polling; FCM push in background)
- **Firebase Cloud Messaging (FCM)**: Native Android push notifications
- Distributed via Google Play Store

**Web/PWA (Next.js) — First-Class iOS Fallback:**
- All customer features: login, products, cart, checkout, orders, tracking
- Installable on iPhone via Safari "Add to Home Screen"
- `manifest.json` → full-screen standalone experience
- Service Worker → offline product catalog cache
- Web Push API → notifications on iOS 16.4+ and all Android browsers
- Server-side rendering → fast initial load, SEO-ready
- Responsive design: mobile-first, works on iPhone, Android, desktop

**What is shared between Android and Web (no duplication):**

| Shared Package | Contents |
|---|---|
| `packages/api-client` | All HTTP calls to `/api/v1/*` — identical on Android and Web |
| `packages/types` | `Order`, `Product`, `Cart`, `User`, `Address` TypeScript interfaces |
| `packages/validation` | Phone number format, quantity rules, cancellation eligibility |
| `packages/constants` | `ORDER_STATUS`, delivery fee, error codes, status labels |
| Backend REST API | Identical endpoints, auth, and business rules for all clients |

**What is intentionally separate (platform-appropriate UI):**

| Layer | Android (React Native) | Web/PWA (Next.js) |
|---|---|---|
| UI components | `View`, `Text`, `FlatList`, `Pressable` | `div`, `p`, `ul`, `button` |
| Navigation | React Navigation 6 | Next.js App Router |
| Push notifications | FCM (`@react-native-firebase/messaging`) | Web Push API + Service Worker |
| Storage | AsyncStorage | localStorage / httpOnly cookie |
| Build output | APK / AAB (Play Store) | Static + SSR (Vercel / self-hosted) |

**Rider App (Next.js PWA):**
- View assigned orders
- Update delivery status (Picked Up → Delivered / Customer Unavailable)
- Record COD cash collected
- Rider availability toggle
- No app store submission needed — accessed via browser on rider's phone

**Admin Dashboard (Next.js):**
- Order management + status updates
- Manual rider assignment
- Product / catalog management (with image upload)
- Inventory management
- Daily cash reconciliation
- Reports / analytics

### B. Backend Architecture (Modular Monolith)

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/           # OTP, JWT, sessions
│   │   ├── users/          # Customer profiles
│   │   ├── addresses/      # Delivery addresses
│   │   ├── products/       # Catalog, categories
│   │   ├── pricing/        # Markup calculation
│   │   ├── inventory/      # Stock management
│   │   ├── cart/           # Cart operations
│   │   ├── orders/         # Order lifecycle
│   │   ├── payments/       # COD tracking
│   │   ├── riders/         # Rider management
│   │   ├── deliveries/     # Delivery assignment
│   │   ├── notifications/  # SMS/WhatsApp/push
│   │   └── admin/          # Admin-only operations
│   ├── shared/
│   │   ├── middleware/     # Auth, rate limit, validation
│   │   ├── database/       # Prisma client
│   │   ├── jobs/           # Background jobs
│   │   └── utils/
│   └── app.ts
```

**Why modular monolith?**
- At 50 orders/day, a single process handles all traffic easily
- Modules are self-contained and can be extracted to microservices in Phase 3 without rewriting business logic
- One deployment, one database connection, one codebase to maintain

### C. Database Architecture

Single PostgreSQL instance. Schema designed for multi-store from day one. See Section 7 for full schema.

### D. API Architecture

REST API with JSON. Versioned under `/api/v1/`. See Section 16 for full API design.

### E. Authentication

- **Customer auth**: Mobile OTP (SMS) → JWT access token (15 min) + refresh token (30 days)
- **Rider auth**: Username/password + OTP → JWT
- **Admin auth**: Email/password (bcrypt) + optional 2FA → JWT with admin role
- **No passwords for customers** — phone-number-based OTP only (frictionless, no forgotten passwords)

**Why OTP for customers?**
- Sri Lanka mobile penetration is high
- Simpler onboarding than email/password
- Reduces fake account creation

### F. Authorization / RBAC

| Role | Description |
|---|---|
| `CUSTOMER` | Browse, cart, checkout, view own orders |
| `RIDER` | View assigned orders, update delivery status |
| `STORE_STAFF` | Manage orders, inventory, pack orders |
| `ADMIN` | Full access |
| `SUPER_ADMIN` | Multi-store access, system config |

Middleware checks `req.user.role` against route permission matrix. All role checks server-side; frontend only hides UI elements.

### G. Product/Catalog Architecture

```
Category (e.g., "Dairy")
  └── SubCategory (e.g., "Milk") [optional Phase 1]
        └── Product
              ├── name, description, images
              ├── purchase_cost
              ├── custom_markup (optional)
              ├── is_active
              └── ProductInventory (per dark store)
```

Products are global. Inventory is per dark store. This enables Phase 2 (multiple dark stores with different stock levels).

### H. Pricing Architecture

```
selling_price = purchase_cost × (1 + effective_markup)

effective_markup = 
  IF product.custom_markup IS NOT NULL → product.custom_markup
  ELSE → system_config.default_markup (20%)
```

**Historical price preservation:**
- `order_items.unit_cost` stores the purchase cost at the time of order
- `order_items.unit_price` stores the selling price at the time of order
- Price changes to a product do NOT retroactively alter past orders
- Pricing is recalculated at checkout and locked into the order record

### I. Inventory Architecture

**Phase 1 (source-on-demand):**
- `inventory.quantity = NULL` or `-1` means "sourced on demand"
- `inventory.tracking_mode = 'UNTRACKED'`
- All products show as available unless admin marks `is_available = false`
- Staff contacts customer if item is unavailable after order

**Phase 2 (stocked warehouse):**

> **Status (2026-09-19): not implemented as designed below.** The implemented and approved model takes tracked stock when an order item is **sourced** (`ORDER_FULFILLMENT`) and returns it when the order is **cancelled** (`ORDER_CANCELLATION_RESTORE`); there is no checkout reservation and delivery does not deduct again. See business rules §6.1. The reservation design below remains a possible future phase.

- `inventory.tracking_mode = 'TRACKED'`
- `quantity` = physical stock count
- `reserved_quantity` = sum of PLACED + PACKED orders for this product
- `available_quantity = quantity - reserved_quantity`

**Preventing double-selling (Phase 2):**
```sql
-- Atomic reservation using PostgreSQL advisory locks or SELECT FOR UPDATE
BEGIN;
SELECT quantity, reserved_quantity 
FROM inventory 
WHERE product_id = $1 AND dark_store_id = $2
FOR UPDATE;  -- row-level lock

-- Check available_quantity >= requested_quantity
-- If yes: UPDATE reserved_quantity += requested_quantity
-- If no: ROLLBACK and return "out of stock" error
COMMIT;
```

### J. Cart Architecture

- Cart stored **server-side** in the database (linked to user or session token for guests)
- Client maintains local state synced with server
- Cart locked/converted to order on checkout
- Cart items store `product_id`, `quantity`, `snapshot_price` (recalculated at checkout)

**Why server-side cart?**
- Enables cross-device cart persistence
- Allows real-time stock validation when cart is modified

### K. Order Architecture

See Section 9 for full state machine. Order record stores:
- Customer, address, dark store
- Ordered items with locked prices
- Status history (immutable log)
- COD payment reference
- Assigned rider (nullable until assigned)
- Scheduled delivery window if after hours

### L. COD Payment Architecture

```
Order created → status: PENDING_PAYMENT (implicit for COD)
                ↓
Staff packs, rider delivers
                ↓
Rider marks DELIVERED → rider records cash collected
                ↓
Admin reconciles daily cash collection
```

No payment gateway required in Phase 1. 

**COD fraud prevention:**
- Order amount is locked at creation time
- Rider cannot modify order amount
- Admin-only reconciliation view
- Audit log on all status changes

### M. Rider/Delivery Architecture

- Riders are platform users with `RIDER` role
- `deliveries` table links an order to a rider
- Admin manually assigns rider via admin dashboard
- Rider sees assigned orders in rider app
- Rider updates status: `PICKED_UP` → `DELIVERED` / `CUSTOMER_UNAVAILABLE`

**Future automated dispatch (Phase 3):**
- Add `rider_location` table (GPS coordinates, last updated)
- Add dispatch algorithm module that queries available riders sorted by proximity
- No schema changes needed — just a new service consuming existing tables

### N. Notification Architecture

```
Order Event → Notification Service → Queue (BullMQ Phase 2)
                                          ↓
                              Provider Router
                             /              \
                         SMS               WhatsApp
                      (Twilio)          (Twilio WA)
                             \              /
                              Fallback logic
                                    ↓
                            notification_logs table
```

**Phase 1:** Synchronous notification dispatch (direct API call after event). Simple and sufficient for 50 orders/day.

**Phase 2:** Move to BullMQ queue for async dispatch, retry, and failure isolation.

**Idempotency:** Each notification has a unique `idempotency_key = order_id + event_type`. Prevents duplicate SMS on retry.

### O. Image/File Storage

- Admin uploads product images → backend → Cloudflare R2
- Images served via Cloudflare CDN (not directly from R2)
- Multiple sizes stored: `original`, `thumb_200`, `thumb_600`
- Sharp.js used server-side for resize on upload

### P. CDN

Cloudflare (free plan) handles:
- Product image delivery
- Static Next.js assets
- DDoS protection
- SSL termination (free)
- Edge caching with `Cache-Control` headers

### Q. Caching

**Phase 1 — no Redis, use in-memory caching:**
- Product catalog: 5-minute in-memory cache in Node.js process (node-cache)
- System config (default markup, delivery fee): cached until manual invalidation
- OTP codes: stored in PostgreSQL with expiry timestamp (not Redis)

**Why no Redis in Phase 1?**
- 50 orders/day = ~0.035 requests/second. PostgreSQL handles this with ease.
- Redis adds operational complexity (another service to manage, monitor, backup).
- Add Redis in Phase 2 when session volume or catalog size justifies it.

### R. Background Jobs/Queues

**Phase 1 jobs (node-cron):**
- `0 8 * * *` — Send "Good morning, we're open!" notification to customers with pending after-hours orders
- `0 21 * * *` — Alert admin of orders placed after closing time
- `*/5 * * * *` — Check for orders stuck in PLACED for >30 min → alert admin
- `0 2 * * *` — Database backup verification

### S. Logging

- Structured JSON logs using Winston
- Log levels: ERROR, WARN, INFO, DEBUG
- Every API request logged with: `timestamp, method, path, user_id, response_time, status_code`
- Every order status change logged with: `order_id, old_status, new_status, changed_by, timestamp`
- Shipped to Logtail (Better Stack) free tier for search/alerting

### T. Monitoring

- **Sentry**: Error tracking + performance monitoring (free tier)
- **Grafana Cloud**: Server metrics (CPU, RAM, disk) via Prometheus node exporter
- **UptimeRobot**: Free uptime monitoring with SMS alerts
- **Custom health endpoint**: `GET /health` returns DB connection status, uptime, version

### U. Backup

- **PostgreSQL**: DigitalOcean Managed DB daily automated backups (7-day retention)
- **Manual backups**: `pg_dump` via cron, uploaded to Cloudflare R2, 30-day retention
- **Application code**: Git (GitHub) is the source of truth
- **R2 images**: Versioning enabled on R2 bucket

### V. Security

See Section 14 for full security threat model.

### W. Deployment

See Section 19 for full deployment architecture.

### X. Scalability Strategy

See Section 16 (Scalability).

---

## 6. Database ER Diagram

```
┌─────────────────┐         ┌─────────────────┐
│   dark_stores   │         │      users       │
│─────────────────│         │─────────────────│
│ id (PK)         │         │ id (PK)          │
│ name            │         │ phone_number     │
│ address         │         │ name             │
│ latitude        │         │ email (nullable) │
│ longitude       │         │ role             │
│ is_active       │         │ is_active        │
│ city            │         │ created_at       │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ 1:N                       │ 1:N
         │                           │
┌────────▼────────┐         ┌────────▼────────┐
│   service_areas │         │    addresses    │
│─────────────────│         │─────────────────│
│ id (PK)         │         │ id (PK)          │
│ dark_store_id   │         │ user_id (FK)     │
│ name            │         │ label            │
│ boundary (JSONB)│         │ address_line_1   │
│ max_radius_km   │         │ address_line_2   │
│ is_active       │         │ city             │
└─────────────────┘         │ latitude         │
                            │ longitude        │
                            │ is_default       │
                            └─────────────────┘
                                     │
┌─────────────────┐                  │ N:1
│   categories    │         ┌────────▼────────┐
## 7. Database Table Definitions

> [!NOTE]
> **Canonical Database Specification**: The complete, exhaustive production database architecture specification covering all deliverables (ER diagram, table directories, DDL, constraints, indexing rationales, transactions, concurrency prevention, sample data, and 10 production SQL queries) is maintained at:
> [blynk_database_design.md](./blynk_database_design.md)
>
> All schema definitions below are strictly harmonized with the canonical database design specification.

```sql
-- Ensure Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===================================================
-- ENUMERATIONS
-- ===================================================

CREATE TYPE user_role_enum AS ENUM (
    'CUSTOMER',
    'RIDER',
    'PACKING_STAFF',
    'ADMIN'
);

CREATE TYPE inventory_tracking_mode_enum AS ENUM (
    'UNTRACKED', -- Phase 1 default: Sourced/purchased on-demand upon order placement
    'TRACKED'    -- Phase 2 stocked: Strict warehouse inventory deduction
);

CREATE TYPE inventory_adjustment_type_enum AS ENUM (
    'PURCHASE_RESTOCK',
    'ORDER_RESERVATION',
    'ORDER_FULFILLMENT',
    'ORDER_CANCELLATION_RESTORE',
    'DAMAGE_WRITE_OFF',
    'INVENTORY_AUDIT_ADJUSTMENT'
);

-- Primary flow: PLACED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED
CREATE TYPE order_status_enum AS ENUM (
    'PLACED',
    'PACKED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
    'FAILED',
    'CUSTOMER_UNAVAILABLE',
    'ITEM_UNAVAILABLE'
);

CREATE TYPE item_fulfillment_status_enum AS ENUM (
    'PENDING',
    'SOURCED',
    'PACKED',
    'UNAVAILABLE',
    'SUBSTITUTED'
);

CREATE TYPE payment_method_enum AS ENUM (
    'COD',
    'ONLINE'
);

CREATE TYPE payment_status_enum AS ENUM (
    'PENDING',
    'PAID',
    'FAILED',
    'REFUNDED'
);

CREATE TYPE delivery_assignment_status_enum AS ENUM (
    'ASSIGNED',
    'ACCEPTED',
    'PICKED_UP',
    'ARRIVED_AT_CUSTOMER',
    'DELIVERED',
    'FAILED',
    'REJECTED'
);

CREATE TYPE notification_channel_enum AS ENUM (
    'SMS',
    'WHATSAPP',
    'IN_APP',
    'EMAIL'
);

CREATE TYPE notification_status_enum AS ENUM (
    'QUEUED',
    'SENT',
    'DELIVERED',
    'FAILED'
);

-- ===================================================
-- 1. CONFIGURATION & DARK STORES
-- ===================================================

CREATE TABLE system_configurations (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dark_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    address_line TEXT NOT NULL,
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL DEFAULT 4.00,
    contact_phone VARCHAR(20) NOT NULL,
    operating_start_time TIME NOT NULL DEFAULT '08:00:00',
    operating_end_time TIME NOT NULL DEFAULT '21:00:00',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_dark_store_lat CHECK (latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_dark_store_lon CHECK (longitude BETWEEN -180.0 AND 180.0),
    CONSTRAINT chk_dark_store_radius CHECK (radius_km > 0.0)
);

CREATE TABLE service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE CASCADE,
    area_name VARCHAR(128) NOT NULL,
    center_latitude NUMERIC(9, 6) NOT NULL,
    center_longitude NUMERIC(9, 6) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 4000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_service_area_lat CHECK (center_latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_service_area_lon CHECK (center_longitude BETWEEN -180.0 AND 180.0),
    CONSTRAINT chk_service_area_radius CHECK (radius_meters > 0)
);

-- ===================================================
-- 2. USERS & AUTHENTICATION
-- ===================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    full_name VARCHAR(128),
    role user_role_enum NOT NULL DEFAULT 'CUSTOMER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    phone_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'LOGIN',
    attempts_count SMALLINT NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_otp_attempts CHECK (attempts_count <= max_attempts + 1)
);
CREATE INDEX idx_otp_phone ON otp_verifications(phone);
CREATE INDEX idx_otp_expires ON otp_verifications(expires_at);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_info VARCHAR(255),
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(64) NOT NULL DEFAULT 'Home',
    recipient_name VARCHAR(128) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city VARCHAR(64) NOT NULL,
    postal_code VARCHAR(16),
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    delivery_instructions TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_addr_lat CHECK (latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_addr_lon CHECK (longitude BETWEEN -180.0 AND 180.0)
);
CREATE INDEX idx_customer_addresses_user ON customer_addresses(user_id) WHERE is_deleted = FALSE;

-- ===================================================
-- 3. CATALOG & INVENTORY
-- ===================================================

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    sku VARCHAR(64) NOT NULL UNIQUE,
    barcode VARCHAR(64),
    unit VARCHAR(32) NOT NULL,
    pack_size VARCHAR(64),
    image_url TEXT,
    purchase_cost NUMERIC(10, 2) NOT NULL,
    custom_markup_percent NUMERIC(5, 2),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_product_purchase_cost CHECK (purchase_cost >= 0.00),
    CONSTRAINT chk_product_custom_markup CHECK (custom_markup_percent IS NULL OR custom_markup_percent >= 0.00)
);
CREATE INDEX idx_products_category_active ON products(category_id, is_active, is_available)
INCLUDE (name, sku, unit, purchase_cost, custom_markup_percent);

CREATE OR REPLACE VIEW v_product_catalog AS
SELECT 
    p.id,
    p.category_id,
    c.name AS category_name,
    p.name,
    p.slug,
    p.description,
    p.sku,
    p.barcode,
    p.unit,
    p.pack_size,
    p.image_url,
    p.purchase_cost,
    p.custom_markup_percent,
    COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) AS effective_markup_percent,
    ROUND(
        p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) / 100.0)),
        2
    ) AS calculated_selling_price,
    p.is_available,
    p.is_active
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup';

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    tracking_mode inventory_tracking_mode_enum NOT NULL DEFAULT 'UNTRACKED',
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_store_product UNIQUE (dark_store_id, product_id),
    CONSTRAINT chk_inv_qty_on_hand CHECK (quantity_on_hand >= 0),
    CONSTRAINT chk_inv_qty_reserved CHECK (quantity_reserved >= 0)
);

CREATE TABLE inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    adjustment_type inventory_adjustment_type_enum NOT NULL,
    quantity_delta INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reference_order_id UUID,
    notes TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NOTE ON SHOPPING CART IN PHASE 1:
-- Cart state is managed entirely client-side (React Native AsyncStorage / browser localStorage).
-- Upon checkout, the client submits the cart items in the checkout request payload to POST /api/v1/orders.
-- This completely avoids millions of abandoned cart writes in PostgreSQL for Phase 1.

-- ===================================================
-- 4. ORDERS & COMMERCE
-- ===================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(32) NOT NULL UNIQUE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE RESTRICT,
    order_status order_status_enum NOT NULL DEFAULT 'PLACED',
    payment_method payment_method_enum NOT NULL DEFAULT 'COD',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    
    subtotal_amount NUMERIC(10, 2) NOT NULL,
    delivery_fee NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    
    -- 24/7 Ordering support: Scheduled for morning delivery window (8 AM) if ordered after-hours
    scheduled_for TIMESTAMPTZ,
    
    -- Historical Delivery Address Snapshot (Immutable)
    delivery_recipient_name VARCHAR(128) NOT NULL,
    delivery_recipient_phone VARCHAR(20) NOT NULL,
    delivery_address_line1 TEXT NOT NULL,
    delivery_address_line2 TEXT,
    delivery_city VARCHAR(64) NOT NULL,
    delivery_postal_code VARCHAR(16),
    delivery_latitude NUMERIC(9, 6) NOT NULL,
    delivery_longitude NUMERIC(9, 6) NOT NULL,
    delivery_instructions TEXT,
    
    cancellation_reason TEXT,
    cancelled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    customer_notes TEXT,
    internal_notes TEXT,
    
    placed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    packed_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_order_subtotal CHECK (subtotal_amount >= 0.00),
    CONSTRAINT chk_order_delivery_fee CHECK (delivery_fee >= 0.00),
    CONSTRAINT chk_order_total_match CHECK (total_amount = subtotal_amount + delivery_fee)
);
CREATE INDEX idx_orders_customer_placed ON orders(customer_id, placed_at DESC);
CREATE INDEX idx_orders_active_queue ON orders(dark_store_id, order_status, placed_at ASC)
WHERE order_status IN ('PLACED', 'PACKED', 'OUT_FOR_DELIVERY');
CREATE INDEX idx_orders_scheduled ON orders(dark_store_id, scheduled_for ASC)
WHERE scheduled_for IS NOT NULL AND order_status = 'PLACED';

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    
    product_name_snapshot VARCHAR(255) NOT NULL,
    sku_snapshot VARCHAR(64) NOT NULL,
    unit_snapshot VARCHAR(32) NOT NULL,
    
    -- Dual Cost & Price Tracking
    unit_selling_price NUMERIC(10, 2) NOT NULL,
    estimated_unit_cost NUMERIC(10, 2) NOT NULL,
    actual_unit_cost NUMERIC(10, 2),
    markup_percentage_applied NUMERIC(5, 2) NOT NULL,
    
    quantity INTEGER NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL,
    item_status item_fulfillment_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_order_item_qty CHECK (quantity > 0),
    CONSTRAINT chk_order_item_selling_price CHECK (unit_selling_price >= 0.00),
    CONSTRAINT chk_order_item_est_cost CHECK (estimated_unit_cost >= 0.00),
    CONSTRAINT chk_order_item_act_cost CHECK (actual_unit_cost IS NULL OR actual_unit_cost >= 0.00),
    CONSTRAINT chk_order_item_subtotal CHECK (subtotal = unit_selling_price * quantity)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_status order_status_enum,
    new_status order_status_enum NOT NULL,
    changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason_or_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_order_status_history_order ON order_status_history(order_id, created_at ASC);

-- ===================================================
-- 5. PAYMENTS, RIDERS & DELIVERIES
-- ===================================================

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    payment_method payment_method_enum NOT NULL DEFAULT 'COD',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    amount NUMERIC(10, 2) NOT NULL,
    transaction_reference VARCHAR(128),
    gateway_response JSONB,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_amount CHECK (amount >= 0.00)
);

CREATE TABLE riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE RESTRICT,
    vehicle_type VARCHAR(32) NOT NULL DEFAULT 'MOTORCYCLE',
    vehicle_registration_number VARCHAR(32) NOT NULL,
    emergency_contact_phone VARCHAR(20),
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
    assignment_status delivery_assignment_status_enum NOT NULL DEFAULT 'ASSIGNED',
    cod_collected_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    handover_notes TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_delivery_cod_amount CHECK (cod_collected_amount >= 0.00)
);

-- Partial Unique Index: Exactly one active rider assignment per order.
-- Allows reassignment if previous attempt failed or was rejected.
CREATE UNIQUE INDEX uq_deliveries_active_assignment ON deliveries (order_id)
WHERE assignment_status NOT IN ('FAILED', 'REJECTED');

CREATE INDEX idx_deliveries_rider_active ON deliveries (rider_id, assignment_status)
WHERE assignment_status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER');

-- ===================================================
-- 6. NOTIFICATIONS & AUDIT LOGS
-- ===================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    channel notification_channel_enum NOT NULL,
    notification_type VARCHAR(64) NOT NULL,
    recipient VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status notification_status_enum NOT NULL DEFAULT 'QUEUED',
    provider_name VARCHAR(64),
    provider_message_id VARCHAR(128),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_worker_queue ON notifications (status, created_at ASC)
WHERE status = 'QUEUED';

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
```

---

## 8. Order State Machine

```
                    ┌─────────────────────────────────────────────┐
                    │                   PLACED                    │
                    │      (Order placed, awaiting packing)       │
                    └──────────────────┬──────────────────────────┘
                                       │
              ┌────────────────────────┼──────────────────────────┐
              │                        │                          │
              ▼                        ▼                          ▼
       ITEM_UNAVAILABLE              PACKED                   CANCELLED
    (staff finds item OOS,    (items sourced/packed,     (customer cancels
     contacts customer)        actual cost recorded)      before dispatch)
                                       │
                         ┌─────────────┴──────────────┐
                         │                            │
                         ▼                            ▼
                  OUT_FOR_DELIVERY                CANCELLED
                (rider assigned &             (ops emergency
                 dispatched)                   cancellation only)
                         │
           ┌─────────────┼──────────────┐
           │             │              │
           ▼             ▼              ▼
       DELIVERED  CUSTOMER_UNAVAILABLE  FAILED
    (cash collected) (unreachable at   (accident /
                      doorstep)         breakdown)
```

### State Transition Table

| From | To | Who | Conditions |
|---|---|---|---|
| — | `PLACED` | Customer | Checkout completed via mobile app / web PWA. |
| `PLACED` | `PACKED` | PACKING_STAFF, ADMIN | Items sourced & bagged; actual procurement cost recorded. |
| `PLACED` | `ITEM_UNAVAILABLE` | PACKING_STAFF, ADMIN | Staff cannot source item; customer contacted. |
| `PLACED` | `CANCELLED` | CUSTOMER, ADMIN | Customer cancels before order is packed/dispatched. |
| `PACKED` | `OUT_FOR_DELIVERY` | PACKING_STAFF, ADMIN | Rider assigned and dispatched. **Customer cancellation blocked.** |
| `PACKED` | `CANCELLED` | ADMIN | Emergency operations cancellation. |
| `OUT_FOR_DELIVERY` | `DELIVERED` | RIDER, ADMIN | Goods handed over; COD cash collected. |
| `OUT_FOR_DELIVERY` | `CUSTOMER_UNAVAILABLE` | RIDER, ADMIN | Customer unreachable after 3 doorstep contact attempts. |
| `OUT_FOR_DELIVERY` | `FAILED` | RIDER, ADMIN | Delivery refused or motorcycle breakdown. |

### Invalid Transitions (rejected with HTTP 422)
- `DELIVERED` → any state (terminal)
- `CANCELLED` → any state (terminal)
- `PLACED` → `OUT_FOR_DELIVERY` (must be `PACKED` first)
- Customer cancellation when status is `OUT_FOR_DELIVERY` or `DELIVERED`

### Status History
- `order_status_history` is **append-only** — no updates or deletes
- Every status change writes a new row
- `changed_by` is always recorded (user ID or NULL for system)
- Database-level: enforce via trigger or application-layer policy

---

## 9. Customer Order Flow

```
1. Customer opens app/PWA
2. Login via OTP (phone number → SMS OTP → JWT)
3. Browse products by category or search
4. Add items to cart (server-synced)
5. View cart → system calculates selling prices at this moment
6. Proceed to checkout:
   a. Select/add delivery address
   b. System validates address within 4 km of dark store
   c. If outside range → error: "Sorry, we don't deliver to your area yet"
7. Review order summary (items + prices + 70 LKR delivery fee)
8. Place Order button:
   a. POST /api/v1/orders
   b. Prices recalculated and locked
   c. If TRACKED mode: inventory reserved
   d. Order created with status PLACED
   e. order_number generated (BLK-YYYYMMDD-NNN)
   f. If after 9 PM or before 8 AM: scheduled_for = next delivery window
9. Notification sent: "Order #BLK-xxx received!"
10. Customer sees order status screen
11. Status updates pushed via polling (Phase 1) or WebSocket/SSE (Phase 2)
12. On DELIVERED: "Your order has been delivered. Enjoy!"
```

### After-Hours Order Flow

> **REQUIRES BUSINESS CONFIRMATION**: The following is a recommended behavior.

- Orders after 9 PM: accepted, status PLACED, `scheduled_for = next day 8:00 AM`
- Customer sees message: *"Your order will be delivered tomorrow between 8 AM – 9 PM."*
- Staff sees the order in the dashboard at 8 AM with a "Scheduled" label
- If customer wants to cancel overnight order: allowed until 8 AM next day

---

## 10. Rider Flow

```
1. Rider logs into Rider PWA (phone + password)
2. Rider sets availability: "I'm available" toggle
3. Admin assigns order to rider (admin dashboard → select order → select rider)
4. Rider receives notification: "New delivery assigned: Order #BLK-xxx"
5. Rider app shows:
   - Customer name (first name only)
   - Delivery address
   - Order total (for COD collection)
   - Item list (to verify pack)
6. Rider picks up order from dark store
7. Rider taps "Picked Up" → status → OUT_FOR_DELIVERY
8. Rider navigates to customer (Google Maps link with coordinates)
9. On arrival:
   - If delivered: Rider taps "Delivered" → enters cash collected amount → DELIVERED
   - If customer unavailable: Rider taps "Customer Unavailable" → CUSTOMER_UNAVAILABLE
10. Admin notified of outcome
11. End of day: Rider cash reconciliation via admin dashboard
```

---

## 11. Admin Flow

```
1. Admin logs into admin dashboard (email + password + optional 2FA)
2. Dashboard shows:
   - Today's orders count + status breakdown
   - Pending orders requiring action
   - Available riders
   - Low stock alerts (Phase 2: TRACKED mode)
3. Order management:
   - View all orders (filter by status, date, rider)
   - Pack order (PLACED → PACKED with actual procurement cost)
   - Handle item unavailability → contact customer → ITEM_UNAVAILABLE or substitute
   - Assign rider (PACKED → select rider → OUT_FOR_DELIVERY)
   - Override order status if needed
4. Product management:
   - Add/edit products
   - Upload images → stored in R2 → served via CDN
   - Set purchase cost + optional custom markup
   - Mark products available/unavailable
5. Inventory management:
   - Adjust stock quantities
   - Log adjustment reason
   - View inventory history
6. Rider management:
   - Add/manage riders
   - View daily delivery summary
   - Cash reconciliation
7. Reports:
   - Daily/weekly order volume
   - Revenue
   - Delivery success rate
```

---

## 12. Inventory Flow

```
PHASE 1 (UNTRACKED / Source-on-demand):

Order Placed
    ↓
Inventory check: is_available = true?
    ↓ YES                ↓ NO
Order accepted    Order flagged, staff
                  contacts customer
                  → ITEM_UNAVAILABLE or
                    substitute item

Staff sources item externally
    ↓
Item packed
    ↓
Order status → PACKED

---

PHASE 2 (TRACKED / Stocked) - DESIGN ONLY, NOT IMPLEMENTED (see business rules §6.1 for the implemented flow:
sourcing takes the units, cancellation returns them, nothing else moves stock):

Order Placed
    ↓
SELECT FOR UPDATE on inventory row
    ↓
available_quantity = quantity - reserved_quantity >= requested_quantity?
    ↓ YES                          ↓ NO
Reserve: reserved_quantity += n    Return "Out of stock" error
Order accepted
    ↓
Order DELIVERED
    ↓
quantity -= units_delivered
reserved_quantity -= reserved_amount
    ↓
If quantity <= reorder_point:
    Alert admin to restock
```

---

## 13. Pricing Flow

```
Admin sets product:
    purchase_cost = 200 LKR
    custom_markup = NULL (use default)

System config:
    default_markup = 20%

Selling price calculation:
    effective_markup = custom_markup ?? default_markup
    selling_price = 200 × (1 + 0.20) = 240 LKR

At checkout:
    Prices recalculated from current purchase_cost + markup
    These prices are LOCKED into order_items.unit_price

If purchase_cost changes to 220 LKR next week:
    → New orders use new price (264 LKR)
    → Old orders still show 240 LKR (locked in order_items)
    → Historical accuracy preserved

Admin can override individual product:
    product.custom_markup = 0.35 (35%)
    selling_price = 200 × 1.35 = 270 LKR

Admin can change default markup:
    system_config WHERE key = 'default_markup_percent' → '25'
    → All products without custom_markup now use 25%
    → Change is instant, no migration needed
```

---

## 14. Payment / COD Flow

```
Customer places order
    ↓
orders.payment_method = 'COD'
orders.payment_status = 'PENDING'
    ↓
Rider picks up order
    ↓
Rider delivers to customer
    ↓
Customer pays cash to rider
    ↓
Rider taps "Delivered" in rider app:
    - Enters cash_collected amount
    - System validates: cash_collected == order.total_amount
    - If mismatch → flagged for admin review
    ↓
deliveries.cod_collected = amount
orders.payment_status = 'COLLECTED'
    ↓
Admin daily reconciliation:
    - Total cash expected = SUM(orders.total_amount WHERE payment_status = 'COLLECTED' AND date = today)
    - Total cash received from riders
    - Flag discrepancies
```

**COD Security:**
- Rider cannot modify order total — it's read-only in rider app
- COD collection amount recorded separately from order total
- Discrepancies automatically flagged
- Full audit trail in `order_status_history` and `audit_logs`

---

## 15. Notification Flow

```
Order Event fires (e.g., status = DELIVERED)
    ↓
NotificationService.send({
    user_id,
    order_id,
    template: 'ORDER_DELIVERED',
    channels: ['SMS', 'WHATSAPP']
})
    ↓
For each channel:
    1. Check if notification already sent (idempotency_key lookup)
    2. Render template with order data
    3. Call provider API (Twilio)
    4. On success: log SENT + provider_ref
    5. On failure: log FAILED + error_message
       → Retry up to 3 times with exponential backoff
       → On final failure: alert admin

Notification templates (stored in code, not DB):
    ORDER_PLACED:    "Hi {name}! Your order #{number} for LKR {total} has been received. We'll confirm it shortly."
    ORDER_CONFIRMED: "Your order #{number} has been confirmed and is being prepared."
    ORDER_PACKED:    "Your order #{number} is packed and a rider will pick it up soon."
    OUT_FOR_DELIVERY:"Your order #{number} is on the way! Expected delivery within 30-45 minutes."
    DELIVERED:       "Your order #{number} has been delivered. Thank you for choosing Blynk!"
    CANCELLED:       "Your order #{number} has been cancelled. Contact us if you have questions."
    ITEM_UNAVAILABLE:"We're sorry, an item in your order #{number} is unavailable. Our staff will contact you."
```

---

## 16. API Architecture

### Base URL: `https://api.blynk.lk/api/v1`

### Authentication APIs

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | None | Request OTP to phone number |
| POST | `/auth/otp/verify` | None | Verify OTP, returns JWT |
| POST | `/auth/refresh` | Refresh Token | Get new access token |
| POST | `/auth/logout` | Bearer | Revoke refresh token |

**POST /auth/otp/request**
```json
Request:  { "phone_number": "+94771234567" }
Response: { "message": "OTP sent", "expires_in": 300 }
Errors:   429 Too Many Requests (rate limit: 3 OTP/hour per phone)
          400 Invalid phone number format
```

**POST /auth/otp/verify**
```json
Request:  { "phone_number": "+94771234567", "otp": "123456" }
Response: { "access_token": "...", "refresh_token": "...", "user": { "id": "...", "name": "...", "role": "CUSTOMER" } }
Errors:   401 Invalid OTP
          410 OTP expired
          429 Too many attempts (lock after 5 failed)
```

### Customer APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/customers/me` | Bearer | CUSTOMER | Get own profile |
| PATCH | `/customers/me` | Bearer | CUSTOMER | Update name/email |

### Address APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/addresses` | Bearer | CUSTOMER | List own addresses |
| POST | `/addresses` | Bearer | CUSTOMER | Add address |
| PUT | `/addresses/:id` | Bearer | CUSTOMER | Update address |
| DELETE | `/addresses/:id` | Bearer | CUSTOMER | Delete address |
| POST | `/addresses/validate` | Bearer | CUSTOMER | Validate delivery area |

**POST /addresses/validate**
```json
Request:  { "latitude": 6.4869, "longitude": 79.9986 }
Response: { "is_serviceable": true, "dark_store_id": "...", "distance_km": 1.8 }
          { "is_serviceable": false, "message": "Sorry, we don't deliver to this area yet." }
```

### Product / Category APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/categories` | None | Public | List all active categories |
| GET | `/products` | None | Public | List products (filter: category, search, page) |
| GET | `/products/:id` | None | Public | Get single product |
| GET | `/products/search` | None | Public | Search products by name |

**GET /products**
```
Query params: ?category_id=&search=&page=1&limit=20&dark_store_id=
Response: {
  "data": [{ "id", "name", "category", "unit", "images", "selling_price", "is_available" }],
  "pagination": { "page": 1, "limit": 20, "total": 250, "pages": 13 }
}
```

### Cart APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/cart` | Bearer | CUSTOMER | Get current cart |
| POST | `/cart/items` | Bearer | CUSTOMER | Add item to cart |
| PATCH | `/cart/items/:product_id` | Bearer | CUSTOMER | Update quantity |
| DELETE | `/cart/items/:product_id` | Bearer | CUSTOMER | Remove item |
| DELETE | `/cart` | Bearer | CUSTOMER | Clear cart |

### Order APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/orders` | Bearer | CUSTOMER | **Place order** |
| GET | `/orders` | Bearer | CUSTOMER | List own orders |
| GET | `/orders/:id` | Bearer | CUSTOMER | Get order detail |
| POST | `/orders/:id/cancel` | Bearer | CUSTOMER | Cancel order |

**POST /orders (Place Order)**
```json
Request: {
  "address_id": "uuid",
  "customer_notes": "Leave at door"
}
Response 201: {
  "id": "uuid",
  "order_number": "BLK-20240914-001",
  "status": "PLACED",
  "subtotal": 840.00,
  "delivery_fee": 70.00,
  "total_amount": 910.00,
  "scheduled_for": null,
  "items": [...]
}
Errors:
  400 Cart is empty
  400 Address outside delivery area
  409 Product(s) out of stock (TRACKED mode)
  422 Invalid address
```

**POST /orders/:id/cancel**
```json
Request:  { "reason": "Changed my mind" }
Response: { "status": "CANCELLED", "cancelled_at": "..." }
Errors:
  403 Cannot cancel — order is already out for delivery
  404 Order not found or not owned by customer
```

### Admin — Order APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/admin/orders` | Bearer | ADMIN, STAFF | List all orders (filters) |
| GET | `/admin/orders/:id` | Bearer | ADMIN, STAFF | Get order detail |
| PATCH | `/admin/orders/:id/status` | Bearer | ADMIN, STAFF | **Update order status** |
| POST | `/admin/orders/:id/assign-rider` | Bearer | ADMIN | **Assign rider** |

**PATCH /admin/orders/:id/status**
```json
Request: { "status": "PACKED", "note": "Items sourced and packed" }
Response: {
  "id": "uuid",
  "status": "PACKED",
  "status_history": [...]
}
Errors:
  422 Invalid transition (e.g., DELIVERED → PLACED)
  403 Insufficient role
```

**POST /admin/orders/:id/assign-rider**
```json
Request: { "rider_id": "uuid" }
Response: { "delivery_id": "uuid", "rider": {...}, "assigned_at": "..." }
Errors:
  409 Rider not available
  422 Order not in PACKED status
```

### Rider APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/rider/orders` | Bearer | RIDER | Get assigned orders |
| PATCH | `/rider/deliveries/:id` | Bearer | RIDER | Update delivery status |
| PATCH | `/rider/availability` | Bearer | RIDER | Toggle availability |

**PATCH /rider/deliveries/:id**
```json
Request: { "action": "DELIVERED", "cod_collected": 910.00 }
         { "action": "CUSTOMER_UNAVAILABLE", "note": "No one home" }
Response: { "delivery_id": "uuid", "status": "DELIVERED", "delivered_at": "..." }
```

### Admin — Product APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/admin/products` | Bearer | ADMIN | Create product |
| PUT | `/admin/products/:id` | Bearer | ADMIN | Update product |
| DELETE | `/admin/products/:id` | Bearer | ADMIN | Deactivate product |
| POST | `/admin/products/:id/images` | Bearer | ADMIN | Upload product image |
| PATCH | `/admin/products/:id/availability` | Bearer | ADMIN,STAFF | Toggle availability |

### Inventory APIs

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/admin/inventory` | Bearer | ADMIN, STAFF | List inventory |
| PATCH | `/admin/inventory/:id` | Bearer | ADMIN, STAFF | Adjust stock |
| GET | `/admin/inventory/:id/history` | Bearer | ADMIN | View adjustment history |

---

## 17. Authentication and Authorization Architecture

### Authentication Flow

```
Customer:
  Phone Number → POST /auth/otp/request
      ↓ SMS sent (Twilio)
  OTP Code → POST /auth/otp/verify
      ↓ OTP validated (bcrypt compare, expiry check, attempt limit)
  Returns: access_token (JWT, 15 min) + refresh_token (httpOnly cookie, 30 days)
      ↓
  All API calls: Authorization: Bearer <access_token>
      ↓
  Token expires → POST /auth/refresh → new access_token

Admin:
  Email + Password → POST /admin/auth/login
      ↓ bcrypt verify
  Returns: access_token + refresh_token
  Optional: TOTP 2FA (Google Authenticator)
```

### JWT Structure

```json
{
  "sub": "user-uuid",
  "role": "CUSTOMER",
  "phone": "+94771234567",
  "dark_store_id": null,
  "iat": 1726300000,
  "exp": 1726300900
}
```

### OTP Security Controls

| Control | Implementation |
|---|---|
| OTP length | 6 digits |
| OTP expiry | 5 minutes |
| Max attempts | 5 attempts → lock for 15 min |
| Max requests | 3 OTPs per phone per hour |
| Storage | bcrypt hash (not plain text) |
| Rate limit | IP-based + phone-based |

### RBAC Matrix

| Resource | CUSTOMER | RIDER | STORE_STAFF | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| Browse products | ✅ | ✅ | ✅ | ✅ | ✅ |
| Place order | ✅ | ❌ | ❌ | ✅ | ✅ |
| Cancel own order | ✅ | ❌ | ❌ | ✅ | ✅ |
| Update order status | ❌ | Partial | ✅ | ✅ | ✅ |
| Assign rider | ❌ | ❌ | ❌ | ✅ | ✅ |
| Update delivery | ❌ | ✅ | ❌ | ✅ | ✅ |
| Manage products | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage inventory | ❌ | ❌ | ✅ | ✅ | ✅ |
| View all orders | ❌ | ❌ | ✅ | ✅ | ✅ |
| System config | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage dark stores | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 18. Security Threat Model

### OTP Security
**Threat:** Attacker brute-forces OTP codes
**Blynk example:** Attacker tries 000000–999999 to steal a customer account
**Mitigation:** 
- 5 attempt limit per OTP → lock (429)
- OTP expires in 5 minutes
- bcrypt-hashed OTP in DB (not reversible)
- Rate limit: 3 OTP requests/hour per phone + 10/hour per IP

### IDOR (Insecure Direct Object Reference)
**Threat:** Customer A accesses Customer B's order by guessing order ID
**Blynk example:** GET /orders/uuid-of-another-customer returns their address + order details
**Mitigation:** All order queries filter by `user_id = req.user.id`. UUIDs instead of sequential IDs make guessing harder.

### Order Price Manipulation
**Threat:** Customer modifies cart price in request payload
**Blynk example:** POST /orders with manipulated prices to pay less
**Mitigation:** Server ALWAYS recalculates prices from DB at checkout. Client-sent prices are IGNORED. Frontend is display-only.

### COD Amount Manipulation
**Threat:** Rider reports collecting less cash than order total
**Blynk example:** Rider reports LKR 500 collected on a LKR 910 order
**Mitigation:** 
- System flags when `cod_collected != total_amount`
- Admin sees flagged deliveries in dashboard
- Full audit log of all delivery updates
- Rider cannot modify order total (read-only in rider app)

### SQL Injection
**Mitigation:** Prisma ORM uses parameterized queries. No raw SQL unless using `$queryRaw` with tagged template literals. Never string concatenation in queries.

### XSS
**Mitigation:** 
- Next.js escapes React output by default
- DOMPurify for any user-generated content rendered as HTML
- Content-Security-Policy headers set via Nginx

### CSRF
**Mitigation:** 
- API is stateless (JWT Bearer tokens, not cookies)
- Refresh token in `httpOnly, SameSite=Strict` cookie
- CORS: only allow `https://blynk.lk` and `https://app.blynk.lk`

### Rate Limiting
**Nginx / Express rate-limit rules:**
- `/auth/*`: 10 req/min per IP
- `/api/*` (public): 60 req/min per IP
- `/api/*` (authenticated): 120 req/min per user
- `/admin/*`: 30 req/min per user

### File Upload Security
**Threat:** Admin uploads malicious executable disguised as product image
**Mitigation:**
- Accept only: image/jpeg, image/png, image/webp
- Validate MIME type server-side (not just extension)
- Max file size: 10 MB
- Images processed by Sharp before storage (strips EXIF, re-encodes)
- Store in isolated R2 bucket (no execution possible)

### Admin Security
- Admin login: email + password (bcrypt, min 12 chars)
- Optional TOTP 2FA (Phase 1: optional, Phase 2: mandatory)
- Admin actions logged in `audit_logs` with IP
- Failed admin login: alert after 3 failures
- Admin JWT expires in 2 hours (shorter than customer)

### Secrets Management
- All secrets in environment variables (never in code)
- `.env` files not committed to Git (`.gitignore`)
- Production secrets stored in DigitalOcean App Platform environment variables or Vault
- Rotate Twilio API keys quarterly

### HTTPS
- Nginx handles SSL termination
- Let's Encrypt certificates auto-renewed
- HTTP → HTTPS redirect enforced
- HSTS header: `Strict-Transport-Security: max-age=31536000`

### Sensitive Data
- Phone numbers: stored in plain text (needed for SMS) but never logged in application logs
- Addresses: never returned to riders (only city + landmark shown)
- Passwords: bcrypt with work factor 12
- OTPs: bcrypt in DB, never logged

### Webhook Security (Twilio)
- Validate Twilio webhook signature using `X-Twilio-Signature` header
- Reject requests without valid signature

---

## 19. CDN Strategy

```
Admin uploads product image (JPEG, 5MB)
    ↓
Backend (Sharp.js) resizes to:
    - original (max 1200px)
    - large (800px)
    - medium (400px)
    - thumb (200px)
    ↓
All sizes uploaded to Cloudflare R2:
    r2://blynk-assets/products/{product_id}/original.webp
    r2://blynk-assets/products/{product_id}/large.webp
    r2://blynk-assets/products/{product_id}/medium.webp
    r2://blynk-assets/products/{product_id}/thumb.webp
    ↓
Product record stores:
    images: ["products/{product_id}/large.webp", ...]
    (relative paths, not full URLs)
    ↓
Client constructs URL:
    https://cdn.blynk.lk/products/{product_id}/medium.webp
    ↓
Cloudflare CDN serves from edge (cached, close to user)
```

**Cache-Control Headers:**
- Product images: `Cache-Control: public, max-age=31536000, immutable` (1 year, content-addressed)
- If image changes: new file path (include hash or timestamp)
- Category images: same strategy

**Why Cloudflare R2?**
- No egress fees (unlike AWS S3)
- Cloudflare CDN integration is native
- Free tier: 10 GB storage, 10M reads/month — sufficient for Phase 1

---

## 20. Caching Strategy

### Phase 1: In-Memory (No Redis)

```javascript
// node-cache with TTL
const cache = new NodeCache({ stdTTL: 300 }); // 5 min default

// Product catalog cache
app.get('/api/v1/products', async (req, res) => {
    const cacheKey = `products:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const products = await db.products.findMany({...});
    cache.set(cacheKey, products);
    res.json(products);
});

// Invalidate on product update
app.put('/admin/products/:id', async (req, res) => {
    await db.products.update({...});
    cache.flushAll(); // simple approach for Phase 1
});
```

### What Gets Cached

| Data | TTL | Why |
|---|---|---|
| Product catalog (by category) | 5 min | Changes rarely, read frequently |
| Categories | 30 min | Changes very rarely |
| System config | 10 min | Changes rarely |
| Delivery fee | 10 min | Stable |
| Dark store info | 30 min | Stable |

### Phase 2: Redis

Add Redis when:
- Multiple backend instances needed (shared cache)
- Session store needed
- OTP codes move from DB to Redis (with TTL)
- BullMQ job queue added

---

## 21. Queue / Background Job Strategy

### Phase 1: node-cron (Simple)

```javascript
// Check for stuck orders every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    const stuckOrders = await db.orders.findMany({
        where: {
            status: 'PLACED',
            placed_at: { lt: new Date(Date.now() - 30 * 60 * 1000) }
        }
    });
    if (stuckOrders.length > 0) {
        await notifyAdmin(`${stuckOrders.length} orders stuck in PLACED for >30 min`);
    }
});

// Morning activation of after-hours orders (8:00 AM daily)
cron.schedule('0 8 * * *', async () => {
    const scheduledOrders = await db.orders.findMany({
        where: {
            status: 'PLACED',
            scheduled_for: { lte: new Date() }
        }
    });
    for (const order of scheduledOrders) {
        await notifyAdmin(`Scheduled order ${order.order_number} is ready for processing`);
    }
});
```

### Phase 2: BullMQ + Redis

Move notification dispatch to BullMQ queues:
```
NotificationQueue → Workers → Twilio API
                          ↓ (on failure)
                      Retry (3x, exponential backoff)
                          ↓ (final failure)
                      DeadLetterQueue → Admin alert
```

**Why not BullMQ in Phase 1?**
- BullMQ requires Redis → another service to manage
- 50 orders/day = ~10 notifications/day → synchronous dispatch is fine
- Add BullMQ when notification volume or failures become a problem

---

## 22. Phase 1 Deployment Architecture

```
Internet
    ↓
Cloudflare (DNS + CDN + DDoS + SSL)
    ↓
DigitalOcean Droplet (2 vCPU / 4 GB RAM / 80 GB SSD) (~$24/month)
    ├── Nginx (reverse proxy, SSL termination, rate limiting)
    │   ├── → Next.js customer PWA (:3000)
    │   ├── → Next.js admin dashboard (:3001)
    │   ├── → Node.js API server (:4000) [PM2 cluster, 2 workers]
    │   └── → Static files / health checks
    └── PM2 (process manager, auto-restart, log rotation)

DigitalOcean Managed PostgreSQL (1 vCPU / 1 GB RAM) (~$15/month)
    └── Daily automated backups (7-day retention)

Cloudflare R2 (object storage) (~$0–$5/month)
    └── Product images (served via Cloudflare CDN)

External APIs:
    ├── Twilio (SMS + WhatsApp)
    └── Google Maps API (address autocomplete, distance calculation)

Total infra cost: ~$40-45/month
```

### Nginx Config (simplified)

```nginx
server {
    listen 443 ssl;
    server_name api.blynk.lk;
    
    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
    
    location /api/v1/auth {
        limit_req zone=auth burst=5 nodelay;
        proxy_pass http://localhost:4000;
    }
    
    location /api/ {
        limit_req zone=api burst=20;
        proxy_pass http://localhost:4000;
    }
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' cdn.blynk.lk;";
}
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  deploy:
    steps:
      - Checkout code
      - Run tests (jest)
      - Run Prisma migrations: prisma migrate deploy
      - Build Next.js apps
      - SSH to Droplet:
          - git pull
          - npm ci --production
          - prisma migrate deploy
          - pm2 reload all --update-env
```

---

## 23. Phase 2 Scaling Architecture

**Trigger:** 500+ orders/day, second city (Beruwala), multiple dark stores

```
Cloudflare (DNS + CDN)
    ↓
DigitalOcean Load Balancer (~$12/month)
    ├── Backend Instance 1 (2 vCPU / 4 GB)
    └── Backend Instance 2 (2 vCPU / 4 GB)

DigitalOcean Managed PostgreSQL (upgraded: 2 vCPU / 4 GB + read replica)
Redis (Managed Redis, 1 GB) — session store, BullMQ, cache
BullMQ notification workers (separate process or worker Droplet)

Two dark stores:
    Dark Store 1: Dharga Town
    Dark Store 2: Beruwala
    Each with own service_area record — zero schema change
```

**What changes in Phase 2:**
- Add Redis for shared caching + BullMQ
- Add second backend instance behind load balancer
- Add PostgreSQL read replica for reporting queries
- Add push notifications (Web Push API)
- Add automated delivery area validation via PostGIS

**What does NOT change:**
- Database schema (designed multi-store from day 1)
- API contracts
- Customer-facing code

---

## 24. Phase 3 Scaling Architecture

**Trigger:** 5,000+ orders/day, multiple cities, automated dispatch needed

```
Cloudflare
    ↓
Load Balancer
    ├── Backend Instance 1–N (auto-scaled)
    └── Dedicated worker instances (notification, dispatch)

PostgreSQL Primary + 2 Read Replicas
Redis Cluster
Elasticsearch (product search at scale)
Separate Dispatch Service (automated rider assignment)
Analytics DB (ClickHouse or BigQuery for reporting)
```

**What gets extracted from the monolith:**
1. Notification Service → separate microservice (already modular)
2. Dispatch Service → new module (automated rider assignment)
3. Search → Elasticsearch for full-text product search
4. Analytics → separate read store

**Why not build this in Phase 1?**
- 50 orders/day = 0.035 req/second. A single Droplet with PostgreSQL handles 1,000+ req/second.
- Every premature optimization adds cost, complexity, and maintenance burden with zero benefit.

---

## 25. Failure Handling Strategy

| Failure | Impact | Mitigation | Phase 1 Required? |
|---|---|---|---|
| Backend crashes | All users get errors | PM2 auto-restarts in <1s | ✅ Yes (PM2) |
| Database unavailable | Orders cannot be placed | Show friendly error; DB managed service with auto-failover | ✅ Managed DB |
| Customer loses internet during checkout | Order may or may not be placed | Idempotency key on POST /orders — same key = same order | ✅ Yes |
| Customer clicks Place Order twice | Double order creation | Idempotency key per cart+timestamp; server deduplication | ✅ Yes |
| Two customers buy last item | Oversell | SELECT FOR UPDATE in TRACKED mode. UNTRACKED: no prevention needed. | ⚠️ Phase 2 (TRACKED) |
| Notification provider fails | Customer doesn't get SMS | Retry 3x, log failure, admin can see failed notifications | ✅ Yes |
| Rider loses internet | Delivery status not updated | Status update retried when connection restored; show "last seen" | ✅ Yes |
| Customer cancels during fulfillment | Staff already packing | If status is PACKED or later, cancellation rejected with clear message | ✅ Yes |
| Product unavailable after order | Order stuck | Staff marks ITEM_UNAVAILABLE, contacts customer, order updated | ✅ Yes |
| Admin accidentally changes stock | Incorrect inventory | `inventory_adjustments` log + audit trail; rollback via new adjustment | ✅ Yes |
| Server crash after order created | Order exists in DB but customer may not have gotten confirmation | Idempotency key prevents duplicate; customer can check order history | ✅ Yes |
| SMS/WhatsApp provider down | No order notifications | Fallback: try alternative channel. If all fail: log + admin alert | ✅ Yes |

### Idempotency Implementation

```javascript
// Client generates idempotency key before submitting order
const idempotencyKey = `order_${userId}_${cartId}_${Date.now()}`;

// Server checks if order with this key already exists
const existing = await db.orders.findFirst({
    where: { idempotency_key: idempotencyKey }
});
if (existing) return res.status(200).json(existing); // Return existing, don't duplicate

// Proceed to create order
const order = await db.orders.create({
    data: { ...orderData, idempotency_key: idempotencyKey }
});
```

---

## 26. Monitoring / Observability Strategy

### Key Metrics for Blynk

| Metric | Alert Threshold | Tool |
|---|---|---|
| API response time (p95) | >2 seconds | Sentry Performance |
| Error rate | >1% | Sentry |
| Orders placed per hour | Drops to 0 during delivery hours | Custom alert |
| Orders stuck in PLACED >30 min | Any occurrence | node-cron + Slack/SMS alert |
| Notification delivery failure rate | >10% | Custom |
| Database connection pool exhaustion | >80% | Grafana |
| Disk usage | >80% | Grafana |
| SSL certificate expiry | <30 days | UptimeRobot |

### Logging Strategy

```javascript
// Every order event logged
logger.info('order_status_changed', {
    order_id: order.id,
    order_number: order.order_number,
    from_status: oldStatus,
    to_status: newStatus,
    changed_by: req.user.id,
    timestamp: new Date().toISOString()
});

// Never log sensitive data
// ❌ logger.info('OTP sent', { otp: '123456' })
// ✅ logger.info('OTP sent', { phone: '+9477***4567' })
```

### Health Check Endpoint

```json
GET /health
Response: {
  "status": "ok",
  "version": "1.2.3",
  "timestamp": "2024-09-14T18:00:00Z",
  "checks": {
    "database": "ok",
    "notification_provider": "ok"
  },
  "uptime_seconds": 86400
}
```

---

## 27. Backup / Disaster Recovery Strategy

### Backup Schedule

| Data | Method | Frequency | Retention | Location |
|---|---|---|---|---|
| PostgreSQL | DO Managed DB auto-backup | Daily | 7 days | DO managed |
| PostgreSQL | `pg_dump` via cron | Daily | 30 days | Cloudflare R2 |
| Application code | Git | Every commit | Forever | GitHub |
| Product images | R2 versioning | On upload | 30 days | R2 |
| Nginx config | Git | On change | Forever | GitHub |
| Environment variables | Documented in vault | On change | Forever | DigitalOcean vars |

### Recovery Time Objectives

| Scenario | RTO | RPO | Action |
|---|---|---|---|
| App server crash | <1 min | 0 | PM2 auto-restart |
| Full server failure | <30 min | <24 hours | Restore from snapshot + DB restore |
| DB data corruption | <2 hours | <24 hours | Restore from daily backup |
| Accidental table drop | <1 hour | <24 hours | Point-in-time recovery (DO Managed DB) |

### Restore Procedure
1. Provision new Droplet from saved snapshot
2. Restore PostgreSQL from DO backup or `pg_dump` file on R2
3. Update DNS A record to new IP (via Cloudflare, TTL 60s)
4. Verify health check endpoint
5. Total time: ~30 minutes

---

## 28. Development Roadmap

### Sprint 0 — Foundation (Week 1–2)
- [ ] Monorepo setup (Turborepo / Nx)
- [ ] Backend: Express + TypeScript + Prisma setup
- [ ] Database: Initial schema + seed data
- [ ] Auth: OTP flow + JWT
- [ ] CI/CD: GitHub Actions + staging deployment
- [ ] Domain + SSL + Nginx setup

### Sprint 1 — Core Customer Experience (Week 3–4)
- [ ] Product catalog API + frontend
- [ ] Category browsing
- [ ] Product detail pages
- [ ] Cart (add/remove/update)
- [ ] Address management + delivery area validation

### Sprint 2 — Order Flow (Week 5–6)
- [ ] Checkout + place order
- [ ] Order confirmation screen
- [ ] Order history + status tracking
- [ ] Cancel order
- [ ] Basic notifications (SMS on order placed)

### Sprint 3 — Admin & Operations (Week 7–8)
- [ ] Admin dashboard: order management
- [ ] Order status updates
- [ ] Rider management
- [ ] Rider assignment
- [ ] Product management (CRUD + image upload)
- [ ] Inventory management (UNTRACKED mode)

### Sprint 4 — Rider App (Week 9)
- [ ] Rider PWA: view assigned orders
- [ ] Update delivery status
- [ ] COD recording
- [ ] Rider availability toggle

### Sprint 5 — Notifications & Polish (Week 10)
- [ ] WhatsApp notifications
- [ ] All notification events
- [ ] After-hours order scheduling
- [ ] Error tracking (Sentry)
- [ ] Performance optimisation + testing

### Sprint 6 — Launch Preparation (Week 11–12)
- [ ] Security audit
- [ ] Load testing (simulate 100 orders/day)
- [ ] Backup and recovery drill
- [ ] Admin training
- [ ] Soft launch (internal)
- [ ] Public launch: Dharga Town 🚀

---

## 29. What NOT to Build in Phase 1

| Feature | Why Not Now | When to Add |
|---|---|---|
| Redis | 50 orders/day doesn't need it. PostgreSQL is fast enough. | Phase 2: multiple servers |
| Kubernetes | Massive operational overhead for a single-server app | Phase 3: if truly needed |
| Kafka / RabbitMQ | Over-engineering for 10 notifications/day | Phase 3: high volume |
| Microservices | One team, one codebase, simple ops. Modular monolith is right. | Phase 3: if teams scale |
| Automated dispatch | Manual assignment works fine for 1–2 riders | Phase 3: 10+ riders |
| Database sharding | PostgreSQL scales to 100s of millions of rows | Never, unless truly needed |
| Elasticsearch | 300–500 SKUs — ILIKE search in PostgreSQL is fine | Phase 2-3: 10,000+ SKUs |
| ML recommendation engine | No usage data yet | Phase 3 |
| Real-time GPS tracking | Polling is fine. No live map needed for 1–2 riders | Phase 2 |
| Loyalty points / gamification | Focus on core delivery experience first | Phase 2 |
| Multiple payment gateways | COD is the only option and meets customer needs | Phase 2 |
| iOS native app | PWA covers iOS completely | Phase 2: if customers demand it |
| Docker Swarm / k8s | PM2 + single server is simpler and sufficient | Phase 3 |
| PostGIS | Simple haversine formula handles 4 km radius check | Phase 2: irregular zones |
| Warehouse management system | UNTRACKED mode suffices. Stocked inventory is Phase 2. | Phase 2 |
| Referral system | Launch first, grow second | Phase 2 |
| Multi-language | Sri Lanka: Sinhala, Tamil, English. Phase 1: English only. | Phase 2 |

---

## 30. Open Questions Requiring Business Confirmation

> These items have direct architecture implications. Answers needed before implementation.

**[BIZ-01] After-hours orders**
> When a customer places an order at 10 PM, what is the expected behavior?
> - Option A: Accept the order, inform customer it will be delivered tomorrow starting 8 AM ← *Recommended*
> - Option B: Reject the order entirely with a message "We're closed, try again after 8 AM"
> - Option C: Accept the order but allow customer to specify a delivery time slot

**[BIZ-02] Customer unavailability policy**
> When a rider arrives and the customer is unavailable (no one home):
> - How many re-attempts are made?
> - Is there a re-delivery fee?
> - After how many failures does the order get cancelled?
> - Who pays the rider's fuel for re-attempts?

**[BIZ-03] Item substitution policy**
> When an ordered item is unavailable:
> - Does staff suggest a substitute item?
> - Can the customer approve a substitute through the app?
> - Or is it handled entirely by phone call?

**[BIZ-04] Order volume cap**
> Is there a maximum number of orders that can be active simultaneously given 1–2 riders?
> Should the app show "high demand, longer delivery times" or pause ordering?

**[BIZ-05] Cancellation window for after-hours orders**
> If a customer places an order at 11 PM (scheduled for next day), can they cancel:
> - Until 8 AM the next day?
> - Until the order is confirmed by staff?
> - Anytime before OUT_FOR_DELIVERY?

**[BIZ-06] COD exact change policy**
> Can riders give change? Is there a "exact change preferred" message to customers?

**[BIZ-07] Delivery time promise**
> What delivery time is promised to customers? ("within 30 minutes" / "within 1 hour")?
> This affects customer messaging and SLA monitoring.

**[BIZ-08] Minimum order value**
> Is there a minimum order value for delivery? (e.g., LKR 300 minimum)

**[BIZ-09] Multiple orders per customer**
> Can a customer have multiple active orders simultaneously?

**[BIZ-10] WhatsApp business account**
> Does Blynk have a WhatsApp Business account approved for messaging? 
> Twilio WhatsApp requires a pre-approved business number — approval can take 2–4 weeks.

**[BIZ-11] Google Play Store**
> Should the Android app be published to Google Play in Phase 1, or is the PWA + direct APK download sufficient?

**[BIZ-12] Delivery area boundary**
> Is the 4 km radius a straight-line (as-the-crow-flies) distance or road distance?
> Straight-line is simpler to implement; road distance requires Google Maps Distance Matrix API.

---

## Appendix: Technology Decision Log

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Frontend | Next.js PWA | Flutter Web, Vue.js | Next.js: best SEO, PWA support, largest ecosystem, best performance |
| Backend | Node.js + Express | Go, Python/Django, Rails | Team familiarity, async I/O, same language as frontend |
| Database | PostgreSQL | MySQL, MongoDB | ACID transactions critical for orders; relational model fits commerce |
| ORM | Prisma | TypeORM, Sequelize | Type safety, migration tooling, developer experience |
| Object Storage | Cloudflare R2 | AWS S3, GCS | Zero egress fees, native CDN integration |
| SMS | Twilio | Dialog Axiata, Vonage | Best reliability, WhatsApp included, easy Sri Lanka number support |
| Hosting | DigitalOcean | AWS, GCP, Azure | Simpler UI/ops, lower cost, managed PostgreSQL |
| Monolith vs Microservices | Modular Monolith | Microservices | Right tool for Phase 1 scale; modular design enables future extraction |

---

*Document version: 1.0*
*Prepared for: Blynk Phase 1 — Dharga Town Launch*
*Architecture philosophy: Simple Now, Scalable Later*
