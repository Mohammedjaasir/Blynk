-- Rollback of 063. The restored rule has no small-order fee, so it is added NOT VALID: orders that
-- carried one stay as they are.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount - wallet_amount_used + rider_tip) NOT VALID;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_small_order_fee;
ALTER TABLE orders DROP COLUMN IF EXISTS small_order_fee;
