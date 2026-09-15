# ADR-002: Modular Monolith Architecture

## Status
Accepted

## Context
Phase 1 expects ~50 orders/day across 1 dark store and 1–2 riders in Dharga Town.
Adopting microservices, Kafka, event sourcing, or distributed databases at this stage introduces prohibitive operational complexity, network failure points, and distributed transaction anomalies with zero business benefit.

## Decision
Build the backend as a single Node.js (v20 LTS) / TypeScript application structured as a **modular monolith**:
- Distinct domain modules: `auth`, `users`, `catalog`, `pricing`, `inventory`, `orders`, `payments`, `deliveries`, `riders`, `notifications`, `admin`, `audit`, `configuration`.
- Shared PostgreSQL connection pool and in-process service boundaries.
- Asynchronous tasks (SMS / WhatsApp outbox dispatch) run via internal background polling workers.

## Consequences
- Single deployment unit, zero distributed transaction overhead, fast compile and test cycles.
- Modules remain strictly bounded so individual high-throughput domains can be extracted into independent microservices in Phase 3 if horizontal scale demands it.
