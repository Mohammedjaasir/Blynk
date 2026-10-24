-- Migration 055 down: ratings and rider tips removed. Wallet RIDER_TIP rows and
-- orders whose total held a tip would break the restored checks, so those are
-- restored NOT VALID (as 049's down does).
DROP INDEX IF EXISTS uq_wallet_entries_order_tip;
ALTER TABLE wallet_entries DROP CONSTRAINT IF EXISTS chk_wallet_sign;
ALTER TABLE wallet_entries ADD CONSTRAINT chk_wallet_sign CHECK (
  (kind IN ('REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ORDER_PAYMENT_RETURNED') AND amount > 0)
  OR (kind IN ('ORDER_PAYMENT', 'EXPIRED') AND amount < 0)
  OR kind = 'ADJUSTMENT'
) NOT VALID;
ALTER TABLE wallet_entries DROP CONSTRAINT IF EXISTS chk_wallet_kind;
ALTER TABLE wallet_entries ADD CONSTRAINT chk_wallet_kind CHECK (kind IN (
  'REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ADJUSTMENT',
  'ORDER_PAYMENT', 'ORDER_PAYMENT_RETURNED', 'EXPIRED'
)) NOT VALID;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount - wallet_amount_used) NOT VALID;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_rider_tip;
ALTER TABLE orders DROP COLUMN IF EXISTS rider_tip_wallet_at;
ALTER TABLE orders DROP COLUMN IF EXISTS rider_tip_wallet;
ALTER TABLE orders DROP COLUMN IF EXISTS rider_tip;

DROP INDEX IF EXISTS idx_order_ratings_rider;
DROP INDEX IF EXISTS idx_order_ratings_low;
DROP INDEX IF EXISTS idx_order_ratings_created;
DROP TABLE IF EXISTS order_ratings;
