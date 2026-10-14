-- Migration 045 DOWN: no variants, no lead time, no sellable-stock views.
-- Variant stock rows (and their ledger, by CASCADE), variant combo items and
-- the variants themselves are removed; order items keep their product and
-- snapshots but lose the variant columns. v_product_catalog is rebuilt
-- exactly as migration 044 left it.
DROP VIEW IF EXISTS v_product_variant_catalog;
DROP VIEW IF EXISTS v_product_catalog;
DROP VIEW IF EXISTS v_inventory_stock;

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
    (CASE
        WHEN p.pricing_mode = 'FIXED' THEN
            CASE WHEN p.purchase_cost > 0
                 THEN ROUND((p.fixed_selling_price / p.purchase_cost - 1) * 100, 2)
            END
        ELSE COALESCE(p.custom_markup_percent, c.markup_percent, pc.markup_percent, gm.markup_percent)
    END)::NUMERIC AS effective_markup_percent,
    (CASE
        WHEN p.pricing_mode = 'FIXED' THEN p.fixed_selling_price
        ELSE ROUND(
            p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, c.markup_percent, pc.markup_percent, gm.markup_percent) / 100.0)),
            2
        )
    END)::NUMERIC AS calculated_selling_price,
    p.is_available,
    p.is_active,
    p.image_focal_x,
    p.image_focal_y,
    p.offer_price,
    p.offer_ends_at,
    co.offer_percent AS category_offer_percent,
    co.offer_ends_at AS category_offer_ends_at,
    p.display_order,
    p.pricing_mode,
    p.fixed_selling_price,
    c.markup_percent AS category_markup_percent,
    pc.markup_percent AS parent_category_markup_percent,
    gm.markup_percent AS global_markup_percent,
    (CASE
        WHEN p.pricing_mode = 'FIXED' THEN 'FIXED'
        WHEN p.custom_markup_percent IS NOT NULL THEN 'PRODUCT_MARKUP'
        WHEN c.markup_percent IS NOT NULL THEN 'CATEGORY_MARKUP'
        WHEN pc.markup_percent IS NOT NULL THEN 'PARENT_CATEGORY_MARKUP'
        ELSE 'GLOBAL_MARKUP'
    END)::TEXT AS pricing_source
FROM products p
JOIN categories c ON p.category_id = c.id
LEFT JOIN categories pc ON pc.id = c.parent_id AND pc.deleted_at IS NULL
LEFT JOIN LATERAL (
    SELECT COALESCE(
        (SELECT (cfg.value->>'markup_percent')::NUMERIC FROM system_configurations cfg WHERE cfg.key = 'default_markup'),
        20.00
    ) AS markup_percent
) gm ON true
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
WHERE p.deleted_at IS NULL;

-- Combos: back to one row per product.
DROP INDEX IF EXISTS uq_combo_items_product_variant;
DELETE FROM combo_items WHERE variant_id IS NOT NULL;
ALTER TABLE combo_items DROP CONSTRAINT IF EXISTS combo_items_pkey;
ALTER TABLE combo_items DROP CONSTRAINT IF EXISTS fk_combo_items_variant;
ALTER TABLE combo_items DROP COLUMN IF EXISTS variant_id;
ALTER TABLE combo_items DROP COLUMN IF EXISTS id;
ALTER TABLE combo_items ADD CONSTRAINT combo_items_pkey PRIMARY KEY (combo_id, product_id);

-- Orders.
DROP INDEX IF EXISTS idx_order_items_variant;
DROP INDEX IF EXISTS idx_order_items_pending_stock;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS fk_order_items_variant;
ALTER TABLE order_items DROP COLUMN IF EXISTS variant_label_snapshot;
ALTER TABLE order_items DROP COLUMN IF EXISTS variant_id;

-- Inventory: variant rows go (their ledger rows cascade).
DELETE FROM inventory WHERE variant_id IS NOT NULL;
DROP INDEX IF EXISTS idx_inventory_product;
DROP INDEX IF EXISTS uq_inventory_store_variant;
DROP INDEX IF EXISTS uq_inventory_store_product_base;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS fk_inventory_variant;
ALTER TABLE inventory DROP COLUMN IF EXISTS variant_id;
ALTER TABLE inventory ADD CONSTRAINT uq_inventory_store_product UNIQUE (dark_store_id, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_store_product ON inventory (dark_store_id, product_id);

-- Lead time.
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_delivery_lead_days;
ALTER TABLE products DROP COLUMN IF EXISTS delivery_lead_days;

-- Variants.
DROP TRIGGER IF EXISTS trg_product_variants_catalog_changed ON product_variants;
DROP TABLE IF EXISTS product_variants;
