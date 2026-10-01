-- Rollback of 017. Soft-deleted rows stay (they are referenced by orders);
-- restoring the plain UNIQUE constraints fails if a deleted SKU/slug was
-- reused since, which is the honest outcome - resolve those rows first.
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
WHERE cfg.key = 'default_markup';

DROP INDEX IF EXISTS uq_products_sku_live;
DROP INDEX IF EXISTS uq_products_slug_live;
DROP INDEX IF EXISTS uq_categories_slug_live;

ALTER TABLE products ADD CONSTRAINT products_sku_key UNIQUE (sku);
ALTER TABLE products ADD CONSTRAINT products_slug_key UNIQUE (slug);
ALTER TABLE categories ADD CONSTRAINT categories_slug_key UNIQUE (slug);

ALTER TABLE products DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE categories DROP COLUMN IF EXISTS deleted_at;
