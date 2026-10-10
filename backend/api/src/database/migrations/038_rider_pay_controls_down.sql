-- Migration 038 DOWN: no pay models, bonuses or adjustments. Every rider's
-- own model and numbers, every delivery's model/distance/base/bonus snapshot,
-- every bonus line and every staff adjustment are lost; rider_earning_lkr
-- (the total a delivery earned, bonuses included) is left as it is. The
-- 'rider_pay_model', 'rider_bonus_rules' and 'rider_rain_boost'
-- system_configurations rows (if any) are left in place; nothing reads them
-- without this migration's code.
DROP TABLE IF EXISTS rider_pay_adjustments;
DROP TABLE IF EXISTS rider_earning_lines;

ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_parts;
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_model;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_bonus_lkr;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_base_earning_lkr;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_distance_estimated;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_distance_km;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_pay_inputs;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_pay_model;

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_amounts;
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_model;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_min_lkr;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_per_km_lkr;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_base_lkr;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_fixed_lkr;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_model;
