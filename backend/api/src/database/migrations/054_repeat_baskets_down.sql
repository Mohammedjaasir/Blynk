DROP INDEX IF EXISTS idx_orders_repeat_basket;
ALTER TABLE orders DROP COLUMN IF EXISTS repeat_basket_id;
DROP TABLE IF EXISTS repeat_basket_runs;
DROP TABLE IF EXISTS repeat_baskets;
