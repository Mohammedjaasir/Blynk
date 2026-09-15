# ADR-003: PostgreSQL as Primary Database

## Status
Accepted

## Context
A quick-commerce platform requires strict ACID guarantees for inventory reservation, financial ledger integrity, idempotent checkout, and auditable order state progression.
MongoDB or other NoSQL engines lack declarative foreign keys, multi-table transactional integrity, and strong constraints.
PostGIS was evaluated for geodesic boundary calculation, but introduces deployment and extension management overhead that is unnecessary for a 4 km radius circular zone.

## Decision
1. **Engine**: PostgreSQL 15+ as the single relational database.
2. **Primary Keys**: `UUID v4` (`gen_random_uuid()`) for privacy, horizontal scalability, and client-side idempotency generation.
3. **Monetary Precision**: `NUMERIC(10, 2)` for all LKR amounts; never floating point.
4. **Timezones**: Strict `TIMESTAMPTZ` UTC storage; presentation layer formats to `Asia/Colombo` (+05:30).
5. **Spatial Checks**: Store coordinates as `NUMERIC(9, 6)`; calculate 4 km radius via backend Haversine formula. Defer PostGIS to Phase 2/3.
6. **Query Layer**: Kysely query builder with `pg` connection pool.

## Consequences
- Guarantees financial and transactional correctness with zero IEEE 754 precision drift.
- Eliminates sequential ID enumeration scraping attacks.
- Simple, standard Docker and cloud managed PostgreSQL (AWS RDS / Supabase / Neon) compatibility.
