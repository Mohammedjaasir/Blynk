-- Migration 043 DOWN: orders no longer record why their delivery was free.
-- Orders that were free by the basket amount then count as used free
-- deliveries again (orders/free-delivery.ts, as before 043).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_free_delivery_reason;
ALTER TABLE orders DROP COLUMN IF EXISTS free_delivery_reason;
