-- Migration 035 DOWN: no arranged product order; lists go back to A-Z.
-- Category display_order values written by the arrange screen stay (that
-- column predates 035). CREATE OR REPLACE VIEW cannot drop columns, so the
-- view is dropped and rebuilt exactly as migration 033 left it.
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
    co.offer_ends_at AS category_offer_ends_at
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

DROP INDEX IF EXISTS idx_products_category_display_order;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_display_order;
ALTER TABLE products DROP COLUMN IF EXISTS display_order;
