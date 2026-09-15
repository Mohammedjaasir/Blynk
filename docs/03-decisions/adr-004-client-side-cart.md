# ADR-004: Client-Side Shopping Cart Persistence

## Status
Accepted

## Context
In quick-commerce platforms, customers frequently add, increment, and remove items from their carts.
Persisting every cart mutation to a relational database in Phase 1 creates massive write amplification, orphaned abandoned cart records, and unnecessary database load without tangible user benefit.

## Decision
1. **Client Persistence**: Mobile applications (React Native / Flutter) and Web/PWA maintain cart state locally using `AsyncStorage` or browser `localStorage`.
2. **Authoritative Checkout**: Upon checkout, the client transmits an array of `{ product_id, quantity }` and `address_id` to `POST /api/v1/orders`.
3. **Zero Trust in Client Prices**: The backend fetches live catalog data, recomputes authoritative prices, applies markups, calculates delivery fees, and validates geofencing.

## Consequences
- Eliminates database writes for abandoned cart sessions.
- Keeps client interactions instant and responsive even under flaky mobile network conditions.
- Preserves absolute server-side authority over financial calculations and fraud prevention.
