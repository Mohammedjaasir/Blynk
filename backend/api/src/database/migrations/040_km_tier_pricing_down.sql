-- Migration 040 DOWN: no per-km tier pricing (owner, 2026-10-10). Orders lose
-- how their fee was worked out (delivery_fee and standard_delivery_fee stay);
-- riders lose their own distance mode and tier table. The 'delivery_fee' and
-- 'rider_pay_model' rows keep their extra keys; the older code reads only
-- fee_lkr / base_lkr + per_km_lkr, i.e. FLAT and LINEAR.
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_km_tiers;
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_distance_mode;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_km_tiers;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_distance_mode;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_distance;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_fee_mode;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_distance_estimated;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_distance_km;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_fee_mode;
