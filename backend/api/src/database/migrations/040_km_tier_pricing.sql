-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 040: per-km tier pricing - delivery fee and rider distance pay
-- ============================================================================
-- Owner, 2026-10-10: "1st km LKR 100, then an additional amount for the 2nd
-- km, another for the 3rd and 4th". Every started km counts (2.3 km = km 1 +
-- km 2 + km 3) and the last row's amount repeats for further km. Ops and
-- Admin set the amounts; two separate switches and tables:
--
-- * Customer delivery fee: system_configurations 'delivery_fee' (no migration
--   needed) grows {"fee_mode": "FLAT" | "DISTANCE_TIERS", "tiers": [{"km",
--   "lkr"}], "max_fee_lkr"}; a row without fee_mode is FLAT (as before).
--   Each order snapshots how its standard fee was worked out:
--     orders.delivery_fee_mode            FLAT | DISTANCE_TIERS (NULL = older)
--     orders.delivery_distance_km         road km hub -> address (tiers only)
--     orders.delivery_distance_estimated  true = OSRM unavailable, straight
--                                         line x 1.3
--
-- * Rider DISTANCE pay (migration 038): the store default 'rider_pay_model'
--   row grows {"distance_mode": "LINEAR" | "TIERS", "km_tiers": [...]}; a
--   rider's own override:
--     riders.pay_distance_mode  LINEAR | TIERS, NULL = the store default's
--     riders.pay_km_tiers       JSONB [{km, lkr}], NULL = the store default's
--   The settlement snapshot stays in deliveries.rider_pay_inputs (JSONB).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_mode TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC(8,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_estimated BOOLEAN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_fee_mode;
ALTER TABLE orders ADD CONSTRAINT chk_orders_delivery_fee_mode
  CHECK (delivery_fee_mode IS NULL OR delivery_fee_mode IN ('FLAT', 'DISTANCE_TIERS'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_distance;
ALTER TABLE orders ADD CONSTRAINT chk_orders_delivery_distance
  CHECK (delivery_distance_km IS NULL OR delivery_distance_km >= 0);

ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_distance_mode TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_km_tiers JSONB;

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_distance_mode;
ALTER TABLE riders ADD CONSTRAINT chk_riders_pay_distance_mode
  CHECK (pay_distance_mode IS NULL OR pay_distance_mode IN ('LINEAR', 'TIERS'));
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_km_tiers;
ALTER TABLE riders ADD CONSTRAINT chk_riders_pay_km_tiers
  CHECK (pay_km_tiers IS NULL OR jsonb_typeof(pay_km_tiers) = 'array');
