-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 044: selling-price modes (fixed price or markup) and category markup
-- ============================================================================
-- Owner, 2026-10-13: "for every product we need a selling price; pricing can
-- be set either as a FIXED selling price or by MARKUP; and category-wise
-- markup". Admin and Ops both control every option.
--
-- * products.pricing_mode TEXT NOT NULL DEFAULT 'MARKUP' ('MARKUP' | 'FIXED')
-- * products.fixed_selling_price NUMERIC(12,2) NULL (>= 0; > 0 and required
--   while pricing_mode = 'FIXED'). Kept, but ignored, in MARKUP mode.
-- * categories.markup_percent NUMERIC(7,2) NULL (0..999.99). NULL = use the
--   parent category's markup, else the global default.
--
-- The single price rule (also src/modules/pricing/index.ts resolveSellingPrice):
--   FIXED  -> fixed_selling_price
--   MARKUP -> ROUND(purchase_cost * (1 + m / 100), 2) with
--             m = COALESCE(product custom_markup_percent,
--                          own category markup_percent,
--                          parent category markup_percent (live parent only),
--                          system_configurations 'default_markup'.markup_percent,
--                          20.00)
-- pricing_source names which one decided the price: 'FIXED', 'PRODUCT_MARKUP',
-- 'CATEGORY_MARKUP', 'PARENT_CATEGORY_MARKUP' or 'GLOBAL_MARKUP'.
-- effective_markup_percent is m for MARKUP; for FIXED it is the IMPLIED markup
-- over cost, ROUND((fixed / cost - 1) * 100, 2) (negative when sold below
-- cost), and NULL when the cost is 0.
--
-- Existing prices do not move: every product starts MARKUP, no category has
-- a markup, so m = COALESCE(custom, global) exactly as before and the MARKUP
-- expression is the one migrations 001-035 used. One deliberate difference:
-- the global markup is now a LEFT JOIN with the same 20.00 fallback the
-- backend always used, so a database without the 'default_markup' row still
-- lists products (before, the CROSS JOIN hid every product).
--
-- Columns are appended at the end of v_product_catalog; every column before
-- them keeps its name and meaning. The view is dropped and recreated (no
-- other view depends on it) so no column-type comparison can block it.

ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'MARKUP';
ALTER TABLE products ADD COLUMN IF NOT EXISTS fixed_selling_price NUMERIC(12, 2);

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_pricing_mode;
ALTER TABLE products ADD CONSTRAINT chk_products_pricing_mode
  CHECK (pricing_mode IN ('MARKUP', 'FIXED'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_fixed_selling_price;
ALTER TABLE products ADD CONSTRAINT chk_products_fixed_selling_price
  CHECK (fixed_selling_price IS NULL OR fixed_selling_price >= 0);

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_fixed_mode_has_price;
ALTER TABLE products ADD CONSTRAINT chk_products_fixed_mode_has_price
  CHECK (pricing_mode <> 'FIXED' OR (fixed_selling_price IS NOT NULL AND fixed_selling_price > 0));

ALTER TABLE categories ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(7, 2);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_markup_percent;
ALTER TABLE categories ADD CONSTRAINT chk_categories_markup_percent
  CHECK (markup_percent IS NULL OR (markup_percent >= 0 AND markup_percent <= 999.99));

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
    -- Migration 044 (staff reads only; never sent to customers).
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
