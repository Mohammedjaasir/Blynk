DROP INDEX IF EXISTS idx_stock_batches_product;
DROP INDEX IF EXISTS idx_stock_batches_active_expiry;
DROP TABLE IF EXISTS stock_batches;
ALTER TABLE products DROP COLUMN IF EXISTS expiry_tracking;
