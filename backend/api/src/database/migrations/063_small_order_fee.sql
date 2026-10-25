-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 063: small-order fee on an order
-- ============================================================================
-- Owner's brother, 2026-10-25: an order whose item total is under an amount (default LKR 1,000)
-- pays a small fee (default LKR 50), switched on in Admin / Ops (off by default). The fee is
-- snapshotted here, separate from delivery_fee; orders.total_amount already includes it.
-- Run by hand in Coolify; until then the app treats the fee as off (smallOrderFeeReady).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS small_order_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_small_order_fee;
ALTER TABLE orders ADD CONSTRAINT chk_orders_small_order_fee CHECK (small_order_fee >= 0);

-- total_amount is what is still to collect: items + delivery fee + small-order fee - discounts - wallet + the rider's tip.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee + small_order_fee - discount_amount - wallet_amount_used + rider_tip);
