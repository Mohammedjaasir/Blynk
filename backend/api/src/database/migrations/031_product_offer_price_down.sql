-- Migration 031 DOWN: no product offers. CREATE OR REPLACE VIEW cannot drop
-- columns, so the view is dropped and rebuilt exactly as migration 017 left
-- it, then the two columns go. Any offer that was set is lost.
DROP VIEW IF EXISTS v_product_catalog;

CREATE VIEW v_product_catalog AS
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

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_offer_price_positive;
ALTER TABLE products DROP COLUMN IF EXISTS offer_ends_at;
ALTER TABLE products DROP COLUMN IF EXISTS offer_price;
