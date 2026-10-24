DROP TABLE IF EXISTS seller_payouts;
DROP TABLE IF EXISTS seller_submissions;
DROP INDEX IF EXISTS idx_products_seller;
ALTER TABLE products DROP COLUMN IF EXISTS seller_id;
DROP TABLE IF EXISTS sellers;
