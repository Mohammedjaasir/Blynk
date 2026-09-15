# Blynk Quick-Commerce Backend API

Backend application foundation for the **Blynk** grocery quick-commerce delivery platform launching in Dharga Town, Sri Lanka.

Built with **Node.js (v20 LTS)**, **TypeScript**, **PostgreSQL 15+**, and a **modular monolith** architecture.

---

## 1. Prerequisites

- **Node.js**: `v20.x LTS` or higher
- **npm**: `v10.x` or higher
- **PostgreSQL**: `15+` or `16+` (installed locally or running via Docker)

---

## 2. Quick Start & Setup

### A. Environment Configuration
Copy the example environment file and configure variables:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` points to your PostgreSQL instance:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blynk_db
```

### B. Install Dependencies
```bash
npm install
```

### C. Run Database Migrations
Runs all pending migrations deterministically in sequence:
```bash
npm run migrate:up
```
To rollback the latest migration:
```bash
npm run migrate:down
```

### D. Seed Development Data
Seeds Dharga Town hub, categories, products, customer, address, and rider data:
```bash
npm run seed
```

### E. Start Development Server
```bash
npm run dev
```
The server will start at: `http://localhost:3000`.

---

## 3. Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts API in watch mode using `tsx` |
| `npm run build` | Compiles TypeScript source to `./dist` |
| `npm start` | Runs compiled production build from `./dist/server.js` |
| `npm run typecheck` | Validates TypeScript types across the project |
| `npm test` | Executes unit and integration test suite via `vitest` |
| `npm run migrate:up` | Executes pending PostgreSQL database migrations |
| `npm run migrate:down` | Rolls back the latest database migration |
| `npm run seed` | Injects realistic development seed data |

---

## 4. Health Check Endpoint

```bash
curl http://localhost:3000/health
```

#### Response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-09-14T17:25:00.000Z",
    "version": "1.0.0",
    "environment": "development",
    "database": {
      "status": "connected",
      "latencyMs": 4
    }
  }
}
```

---

## 5. Project Structure

```
backend/api/
├── src/
│   ├── config/                      # Environment variables & constants
│   │   └── env.ts                   # Strict Zod environment validator
│   ├── database/                    # Database connection, migrations, seeds
│   │   ├── connection.ts            # Node-Postgres pool & Kysely instance
│   │   ├── migrate.ts               # Migration runner
│   │   ├── types.ts                 # Full TypeScript database schema types
│   │   ├── migrations/              # SQL DDL migrations
│   │   │   ├── 001_initial_schema.sql
│   │   │   └── 001_initial_schema_down.sql
│   │   └── seeds/                   # Development seed scripts
│   │       └── dev_seed.ts
│   ├── middleware/                  # Express middleware
│   │   ├── error.middleware.ts      # Standard RFC 7807 error format & 404
│   │   ├── request-id.middleware.ts # x-request-id correlation UUID
│   │   ├── validate.middleware.ts   # Zod request validation
│   │   ├── auth.middleware.ts       # Authentication guard foundation
│   │   └── role.middleware.ts       # RBAC role verification
│   ├── modules/                     # 13 Domain Modules (Modular Monolith)
│   │   ├── auth/                    # OTP & JWT Authentication
│   │   ├── users/                   # Customer Profiles & Address Book
│   │   ├── catalog/                 # Categories & Products
│   │   ├── pricing/                 # Authoritative Hybrid Markup Engine
│   │   ├── inventory/               # On-Demand Sourcing & Stock Tracking
│   │   ├── orders/                  # Order Lifecycle & Checkout
│   │   ├── payments/                # Cash on Delivery (COD) Settlement
│   │   ├── deliveries/              # Fulfillment & Rider Assignments
│   │   ├── riders/                  # Rider Management & Vehicle Profiles
│   │   ├── notifications/           # Outbox Worker & SMS/WhatsApp
│   │   ├── admin/                   # Operations & Staff Dashboard
│   │   ├── audit/                   # Administrative Event Logging
│   │   └── configuration/           # Dynamic Platform Settings
│   ├── utils/                       # Shared Utilities
│   │   ├── logger.ts                # Pino structured logging with redaction
│   │   ├── phone.ts                 # Sri Lanka E.164 phone normalizer
│   │   ├── geo.ts                   # Haversine 4 km distance calculator
│   │   └── time.ts                  # Operating window & scheduling logic
│   ├── app.ts                       # Express application assembly
│   └── server.ts                    # Bootstrap & graceful shutdown
├── tests/                           # Vitest test suite
│   ├── health.test.ts
│   ├── utils.test.ts
│   ├── error.test.ts
│   └── validation.test.ts
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```
