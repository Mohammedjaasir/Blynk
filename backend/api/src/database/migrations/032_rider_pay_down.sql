-- Migration 032 DOWN: no rider pay types or earnings. Every rider's type and
-- share, the per-delivery earning snapshots and the orders' standard fee are
-- lost. The 'rider_commission' system_configurations row (if any) is left in
-- place; nothing reads it without this migration's code.
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_earning;
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_type;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_earning_lkr;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_commission_percent;
ALTER TABLE deliveries DROP COLUMN IF EXISTS rider_pay_type;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_standard_delivery_fee;
ALTER TABLE orders DROP COLUMN IF EXISTS standard_delivery_fee;

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_commission_percent;
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_type;
ALTER TABLE riders DROP COLUMN IF EXISTS commission_percent;
ALTER TABLE riders DROP COLUMN IF EXISTS pay_type;
