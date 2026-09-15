# ADR-001: Platform Strategy

## Status
Accepted

## Context
Blynk is launching an owned-inventory quick-commerce grocery delivery platform in Sri Lanka.
The business requirements mandate:
- A native Android customer experience for Phase 1.
- An iOS application distributed via the Apple App Store if feasible, but with a guaranteed non-blocking fallback for Safari users (responsive Web Application / PWA).
- A lightweight mobile interface for riders.
- A centralized web dashboard for dark store packing staff and administrative operations.

## Decision
1. **Customer Apps**: Deploy a native Android application for Phase 1, with a responsive Next.js Web/PWA as the first-class fallback for iOS users.
2. **Backend Independence**: The backend API is completely platform-agnostic, serving all clients via a unified RESTful JSON API (`/api/v1`).
3. **Rider & Ops**: Lightweight web/mobile PWA for riders; Next.js dashboard for store operations and packing queues.

## Consequences
- Guarantees immediate launch readiness without being blocked by Apple App Store review cycles.
- Eliminates duplicated business logic across platforms; all core logic resides in the backend.
- Enables code reuse and rapid iteration for the operations team.
