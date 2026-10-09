-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 035: staff-arranged product order inside a category
-- ============================================================================
-- 2026-10-10 (owner): "in the down category like grocery, egg, milk - ops and
-- admin can decide which should be shown first".
--
-- * Categories already carry display_order (lower first); the new
--   PUT /admin/categories/order rewrites it 10, 20, 30... for one set of
--   siblings, so no schema change is needed for them.
-- * products.display_order INTEGER NULL - a product's place in its category,
--   set by PUT /admin/categories/:id/product-order (1..n). NULL = not
--   arranged: those follow the arranged ones, A-Z. Customer lists order by
--   display_order NULLS LAST, then name. Existing rows get NULL, so nothing
--   moves until staff arrange a category.
-- * v_product_catalog gains display_order at the END (every column before it
--   exactly as migration 033 left them), so customer reads can order by it.
-- * products already NOTIFY catalog_changed (migration 011), so open customer
--   apps refresh when an order is saved.

ALTER TABLE products ADD COLUMN IF NOT EXISTS display_order INTEGER;

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_display_order;
ALTER TABLE products ADD CONSTRAINT chk_products_display_order
  CHECK (display_order IS NULL OR display_order >= 1);

CREATE INDEX IF NOT EXISTS idx_products_category_display_order
  ON products (category_id, display_order) WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW v_product_catalog AS
SELECT
    p.id,
    p.category_id,
    c.name AS category_name,
    p.name,
    p.slug,
    p.description,
    p.sku,
    p.barcode,
    p.unit,
    p.pack_size,
    p.image_url,
    p.purchase_cost,
    p.custom_markup_percent,
    COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) AS effective_markup_percent,
    ROUND(
        p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) / 100.0)),
        2
    ) AS calculated_selling_price,
    p.is_available,
    p.is_active,
    p.image_focal_x,
    p.image_focal_y,
    p.offer_price,
    p.offer_ends_at,
    co.offer_percent AS category_offer_percent,
    co.offer_ends_at AS category_offer_ends_at,
    p.display_order
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
LEFT JOIN LATERAL (
    SELECT oc.offer_percent, oc.offer_ends_at
    FROM categories oc
    WHERE oc.id IN (c.id, c.parent_id)
      AND oc.deleted_at IS NULL
      AND oc.offer_percent IS NOT NULL
      AND (oc.offer_ends_at IS NULL OR oc.offer_ends_at > now())
    ORDER BY oc.offer_percent DESC, oc.offer_ends_at DESC NULLS FIRST
    LIMIT 1
) co ON true
WHERE cfg.key = 'default_markup'
  AND p.deleted_at IS NULL;
