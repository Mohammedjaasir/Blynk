-- Migration 036 DOWN: no slot end on orders. scheduled_for (migration 001)
-- keeps each slot's start. The store_hours / store_closure / store_holidays /
-- delivery_slots settings rows are left in system_configurations (harmless;
-- delete them by hand to go back to the 08:00-21:00 default).
DROP INDEX IF EXISTS idx_orders_scheduled_slot;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_scheduled_until;
ALTER TABLE orders DROP COLUMN IF EXISTS scheduled_until;
