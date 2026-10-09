-- Migration 033 DOWN: no category offers, no combo packs. Orders keep their
-- items (order_combo_id goes, so former combo items read as loose items at
-- the prices they were charged); the combo lines and the combos are lost.
-- CREATE OR REPLACE VIEW cannot drop columns, so the view is dropped and
-- rebuilt exactly as migration 031 left it.
DROP TRIGGER IF EXISTS trg_combo_items_catalog_changed ON combo_items;
DROP TRIGGER IF EXISTS trg_combos_catalog_changed ON combos;

DROP INDEX IF EXISTS idx_order_items_order_combo;
ALTER TABLE order_items DROP COLUMN IF EXISTS order_combo_id;
DROP TABLE IF EXISTS order_combos;
DROP TABLE IF EXISTS combo_items;
DROP TABLE IF EXISTS combos;

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
    p.offer_ends_at
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup'
  AND p.deleted_at IS NULL;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_offer_percent;
ALTER TABLE categories DROP COLUMN IF EXISTS offer_ends_at;
ALTER TABLE categories DROP COLUMN IF EXISTS offer_percent;
