# Blynk

**Blynk** is an owned-inventory grocery quick-commerce delivery platform launching in Dharga Town, Sri Lanka. It delivers fresh groceries, pantry essentials, and household goods within a 4 km delivery radius of physical dark store fulfillment hubs.

---

## Repository Structure

```
Blynk/
│
├── apps/
│   └── customer/
│       └── blinkit-clone-Flutter-ecommerce-/   # Flutter mobile customer application
│
├── backend/
│   ├── api/                                    # Modular monolith Node.js/TypeScript REST API
│   │   ├── src/                                # Domain modules, middleware, and database layers
│   │   ├── tests/                              # Vitest automated test suite
│   │   ├── package.json
│   │   └── README.md                           # Backend setup and script reference
│   └── docker-compose.yml                      # Local PostgreSQL 16 development container
│
├── docs/                                       # Canonical documentation repository
│   ├── 01-product/                             # Product Requirements Document (PRD)
│   ├── 02-architecture/                        # System, database, and API architecture specifications
│   ├── 03-decisions/                           # Architecture Decision Records (ADRs)
│   ├── 04-business/                            # Confirmed operational and economic business rules
│   └── 05-implementation/                     # Implementation progress tracking
│
├── .github/                                    # CI/CD workflows and automation
├── .gitignore                                  # Monorepo ignore rules (Node, Flutter, Docker)
└── README.md                                   # Root project documentation
```

---

## Current Status

- **Phase 1 Market**: Dharga Town, Sri Lanka (4 km radius, 1 dark store, 50 orders/day, 70 LKR flat delivery fee, COD only).
- **Backend Platform**: **Stage 1 (Backend Foundation) COMPLETED**. PostgreSQL 15+ schema migrated and seeded, 18/18 tests passing, `/health` endpoint live. Stage 2 (Authentication & Identity) is next.
- **Customer Mobile Application**: Existing Flutter mobile client located in `apps/customer/blinkit-clone-Flutter-ecommerce-/`.

---

## Canonical Documentation

For detailed technical designs, specifications, and business rules, consult the `docs/` repository:

| Section | Document | Description |
|---|---|---|
| **01 Product** | [blynk_prd.md](file:///C:/Users/pc/Downloads/Blynk/docs/01-product/blynk_prd.md) | Official Product Requirements Document |
| **02 Architecture** | [blynk_architecture.md](file:///C:/Users/pc/Downloads/Blynk/docs/02-architecture/blynk_architecture.md) | High-level system architecture and component design |
| **02 Architecture** | [blynk_database_design.md](file:///C:/Users/pc/Downloads/Blynk/docs/02-architecture/blynk_database_design.md) | Complete PostgreSQL schema, DDL, constraints, and indexes |
| **02 Architecture** | [blynk_backend_api_architecture.md](file:///C:/Users/pc/Downloads/Blynk/docs/02-architecture/blynk_backend_api_architecture.md) | Complete REST API contract, request/response payloads, and security |
| **03 Decisions** | [docs/03-decisions/](file:///C:/Users/pc/Downloads/Blynk/docs/03-decisions/) | Architecture Decision Records (ADR 001 to 004) |
| **04 Business** | [business-rules.md](file:///C:/Users/pc/Downloads/Blynk/docs/04-business/business-rules.md) | Confirmed operational and financial rules |
| **05 Implementation** | [implementation-status.md](file:///C:/Users/pc/Downloads/Blynk/docs/05-implementation/implementation-status.md) | Current implementation checklist and roadmap |

---

## Development Guide

### 1. PostgreSQL Database
Start a local PostgreSQL 16 container:
```bash
docker compose -f backend/docker-compose.yml up -d
```
*Or use a locally running PostgreSQL 15+ service listening on port 5432.*

### 2. Backend API
Navigate to the backend directory:
```bash
cd backend/api

# Install dependencies
npm install

# Run database migrations
npm run migrate:up

# Seed development data (Dharga Town hub, categories, products, test users)
npm run seed

# Run automated tests
npm test

# Start the development server (with live reload)
npm run dev
```
The API will be available at: `http://localhost:3000/api/v1`  
Health check endpoint: `http://localhost:3000/health`

### 3. Customer Mobile App (Flutter)
Navigate to the customer application directory:
```bash
cd apps/customer/blinkit-clone-Flutter-ecommerce-

# Fetch Flutter packages
flutter pub get

# Run static analysis
flutter analyze

# Launch on desktop/connected device
flutter run
```
