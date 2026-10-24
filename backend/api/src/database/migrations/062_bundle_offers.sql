-- ============================================================================
-- Migration 062: bundle offers on order items
-- ============================================================================
-- Owner, 2026-10-25: "buy 2 get 1 free" and "spend X, get a gift"
-- (docs/superpowers/plans/2026-10-25-wave2.md, W-B1). The rules live in
-- system_configurations 'bundle_offers' (no table); pricing is done in the
-- real order pricing (orders/order.service.ts priceCart).
--
-- A free unit and a gift are ordinary order_items rows with unit_selling_price
-- 0 (so stock is reserved / packed like any item and the totals CHECK
-- chk_order_total_match is untouched). These columns say which offer made the
-- row and what it would have cost:
--   bundle_offer_id     the offer's id (text, from the settings JSON)
--   bundle_kind         FREE_UNITS (units of a BUY_X_GET_Y) or GIFT (SPEND_GET_GIFT)
--   bundle_title        the offer's title when it applied
--   bundle_value        what the row would have cost (savings), LKR
--   bundle_rule         the rule as it applied ({buy_qty,get_qty,product_ids,category_id}),
--                       so a removed item can recompute the free units later
--
-- The API is deployed before this runs (migrations are run by hand in
-- Coolify): it checks for these columns (orders/bundle-offers.ready.ts) and
-- applies no offer, and GET /store lists none, until they exist.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_offer_id VARCHAR(64)   NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_kind     VARCHAR(16)   NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_title    VARCHAR(80)   NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_value    NUMERIC(10, 2) NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_rule     JSONB         NULL;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_bundle;
ALTER TABLE order_items ADD CONSTRAINT chk_order_item_bundle CHECK (
  (bundle_kind IS NULL AND bundle_offer_id IS NULL)
  OR (bundle_kind IN ('FREE_UNITS', 'GIFT') AND bundle_offer_id IS NOT NULL AND unit_selling_price = 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_bundle ON order_items (order_id) WHERE bundle_kind IS NOT NULL;
