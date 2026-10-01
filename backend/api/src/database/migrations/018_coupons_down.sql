-- Rollback of 018. Fails (chk_order_total_match) while any order carries a
-- discount - the honest outcome: those orders' totals only add up with it.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_nonnegative;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_discount;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match CHECK (total_amount = subtotal_amount + delivery_fee);
ALTER TABLE orders DROP COLUMN IF EXISTS coupon_code;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_amount;

DROP TABLE IF EXISTS coupon_redemptions;
DROP TABLE IF EXISTS coupons;
