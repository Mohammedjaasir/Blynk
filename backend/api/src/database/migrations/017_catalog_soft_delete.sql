-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 017: deleting products and categories
-- ============================================================================
-- Blynk Ops and Admin can now delete a product or a category.
--
-- * A product that was never ordered is removed outright. One that appears
--   in an order cannot be (order_items / sourcing_records reference it, ON
--   DELETE RESTRICT, and the order history must keep pointing at it), so it
--   is soft-deleted: deleted_at is set and is_active/is_available cleared.
--   is_active alone already means "hidden, can be switched back on"; a
--   deleted product must never come back, so it gets its own column.
-- * A category whose only products are soft-deleted ones cannot be removed
--   either (products.category_id is RESTRICT), so it is soft-deleted too.
-- * SKU and slug stay unique among live rows only, so a deleted product's SKU
--   (or a deleted category's slug) can be used again. The partial indexes
--   replace the plain UNIQUE constraints.
-- * v_product_catalog - the customer and admin product read - skips deleted
--   products, so they vanish from every list, search and shelf at once.
--   Orders keep their own snapshot (order_items.product_name_snapshot etc.).
--
-- The migration 011 triggers already NOTIFY catalog_changed on these writes,
-- so customer apps refresh as soon as something is deleted.

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_slug_key;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku_live ON products (sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug_live ON products (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_slug_live ON categories (slug) WHERE deleted_at IS NULL;

-- Same columns in the same order as migration 009; only the WHERE changes.
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
    p.image_focal_y
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup'
  AND p.deleted_at IS NULL;
