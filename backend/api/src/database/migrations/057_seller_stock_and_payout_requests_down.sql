DROP INDEX IF EXISTS idx_seller_payout_requests_seller;
DROP INDEX IF EXISTS idx_seller_payout_requests_status;
DROP INDEX IF EXISTS uq_seller_payout_requests_open;
DROP TABLE IF EXISTS seller_payout_requests;
DROP INDEX IF EXISTS idx_seller_stock_notes_seller;
DROP INDEX IF EXISTS idx_seller_stock_notes_open;
DROP TABLE IF EXISTS seller_stock_notes;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_seller_commission;
ALTER TABLE categories DROP COLUMN IF EXISTS seller_commission_percent;

-- sellers without an override go back to 0 (the old default)
UPDATE sellers SET commission_percent = 0 WHERE commission_percent IS NULL;
ALTER TABLE sellers ALTER COLUMN commission_percent SET DEFAULT 0;
ALTER TABLE sellers ALTER COLUMN commission_percent SET NOT NULL;
