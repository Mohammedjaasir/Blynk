DROP INDEX IF EXISTS idx_order_items_bundle;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_bundle;
ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_rule;
ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_value;
ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_title;
ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_kind;
ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_offer_id;
