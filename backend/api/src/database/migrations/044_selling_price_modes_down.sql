-- Migration 044 DOWN: no fixed selling prices, no category markup.
-- Products that were FIXED go back to their stored markup (custom or global)
-- and category markups are forgotten. v_product_catalog is dropped and
-- rebuilt exactly as migration 035 left it (CREATE OR REPLACE VIEW cannot
-- drop columns), then the 044 columns and constraints are removed.
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

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_markup_percent;
ALTER TABLE categories DROP COLUMN IF EXISTS markup_percent;

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_fixed_mode_has_price;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_fixed_selling_price;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_pricing_mode;
ALTER TABLE products DROP COLUMN IF EXISTS fixed_selling_price;
ALTER TABLE products DROP COLUMN IF EXISTS pricing_mode;
