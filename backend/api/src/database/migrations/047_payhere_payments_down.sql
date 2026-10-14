-- Migration 047 DOWN: PayHere online payments removed.
-- PostgreSQL cannot drop an enum value, so AWAITING_PAYMENT stays in
-- order_status_enum (unused). Unpaid online orders are cancelled first so no
-- order is left in it; paid online orders keep payment_method ONLINE.
-- (Runs inside the migration transaction; the value already exists, so it
-- may be used here.)
INSERT INTO order_status_history (order_id, old_status, new_status, reason_or_notes)
SELECT id, order_status, 'CANCELLED', 'Online payments removed (migration 047 down)'
  FROM orders WHERE order_status = 'AWAITING_PAYMENT';
UPDATE orders
   SET order_status = 'CANCELLED',
       cancellation_reason = 'Online payments removed',
       cancelled_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
 WHERE order_status = 'AWAITING_PAYMENT';

DROP TABLE IF EXISTS payment_notifications;

ALTER TABLE payments DROP COLUMN IF EXISTS failed_at;
ALTER TABLE payments DROP COLUMN IF EXISTS refund_required;
ALTER TABLE payments DROP COLUMN IF EXISTS gateway_status_message;
ALTER TABLE payments DROP COLUMN IF EXISTS gateway_method;
ALTER TABLE payments DROP COLUMN IF EXISTS gateway_status_code;
ALTER TABLE payments DROP COLUMN IF EXISTS gateway_payment_id;
ALTER TABLE payments DROP COLUMN IF EXISTS gateway;

DROP INDEX IF EXISTS idx_orders_payment_expires_at;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_expires_at;

DROP TABLE IF EXISTS payment_gateway_settings;
