-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 036: scheduled delivery slots
-- ============================================================================
-- 2026-10-10 (owner): "make sure the timing will be decided by ops and admin".
-- Opening hours, "close the store now", the holiday list and the delivery
-- slot settings are system_configurations rows ('store_hours',
-- 'store_closure', 'store_holidays', 'delivery_slots'; a missing row means
-- the default: 08:00-21:00 every day, open, no holidays, slots off), so they
-- need no schema change.
--
-- * orders.scheduled_until TIMESTAMPTZ NULL - the end of the delivery slot the
--   customer picked; orders.scheduled_for (migration 001) holds its start.
--   NULL for "as soon as possible" orders and for every order placed before
--   this migration, so nothing existing changes.
-- * idx_orders_scheduled_slot - counts the orders already booked into a slot
--   (capacity) without scanning every order.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_until TIMESTAMPTZ;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_scheduled_until;
ALTER TABLE orders ADD CONSTRAINT chk_orders_scheduled_until
  CHECK (scheduled_until IS NULL OR (scheduled_for IS NOT NULL AND scheduled_until > scheduled_for));

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_slot
  ON orders (scheduled_for) WHERE scheduled_for IS NOT NULL;
