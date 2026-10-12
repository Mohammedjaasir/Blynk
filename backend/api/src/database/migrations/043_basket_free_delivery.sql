-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 043: why an order's delivery was free (basket threshold)
-- ============================================================================
-- Owner, 2026-10-12: "free delivery above a basket amount". Admin/Ops switch
-- it on and set the amount (system_configurations 'basket_free_delivery',
-- {"enabled", "min_subtotal_lkr"}; no row = off). An order whose item
-- subtotal (orders.subtotal_amount: after item/category offers and combo
-- prices, before coupons, birthday gift, referral reward and points) is at or
-- above the amount is charged no delivery fee.
--
-- A delivery made free by the basket amount must NOT use up one of the
-- customer's free deliveries (orders/free-delivery.ts counts every earlier
-- order since `since`). So each order records why its fee was waived:
--   orders.free_delivery_reason
--     NULL               fee charged (or an order from before 043)
--     'NEW_CUSTOMER'     one of the customer's free deliveries
--     'BASKET_THRESHOLD' the basket amount - not counted as a free delivery
-- The basket amount is checked first, so it never consumes a free delivery.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS free_delivery_reason TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_free_delivery_reason;
ALTER TABLE orders ADD CONSTRAINT chk_orders_free_delivery_reason
  CHECK (free_delivery_reason IS NULL OR free_delivery_reason IN ('NEW_CUSTOMER', 'BASKET_THRESHOLD'));
