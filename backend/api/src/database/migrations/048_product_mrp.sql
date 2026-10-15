-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 048: MRP (Maximum Retail Price) on products and sizes
-- ============================================================================
-- Owner, 2026-10-14:
--   * Each product AND each size (variant) gets an optional MRP (LKR, > 0,
--     2 decimals).
--   * Cap at MRP: when the computed selling price (markup or fixed) is higher
--     than the MRP, the customer pays the MRP. Staff see "Capped at MRP".
--   * Customers see the MRP struck through only when the price they pay is
--     lower than it.
--   (046 was never used; this follows 047.)
--
-- * products.mrp / product_variants.mrp NUMERIC(12,2) NULL, CHECK > 0.
--   NULL = no MRP (no cap). A size's MRP is its own: a variant without an MRP
--   is not capped by its product's MRP (sizes have different printed prices).
-- * order_items.mrp_snapshot NUMERIC(12,2) NULL: the MRP of the product/size
--   when it was ordered (reporting; the charged price stays
--   unit_selling_price).
--
-- THE CAP IS APPLIED IN ONE PLACE PER LANGUAGE:
--   SQL        - calculated_selling_price of v_product_catalog and
--                v_product_variant_catalog is now LEAST(computed, mrp)
--                (LEAST ignores a NULL MRP). Every reader of those views -
--                catalog lists, product page, offers, combos, the on-offer
--                filter, staff screens - gets the capped price.
--   TypeScript - src/modules/pricing/index.ts resolveSellingPrice /
--                resolveVariantPrice (the views' twins) cap the same way;
--                order creation (priceCart), the offer checks and the Excel
--                import all go through them.
--
-- Appended view columns (every earlier column keeps its name, type and
-- meaning, except that calculated_selling_price is now the capped price):
--   mrp                    - the MRP (NULL when none)
--   computed_selling_price - the price before the cap (markup or fixed)
--   mrp_capped             - true when computed_selling_price > mrp
-- effective_markup_percent / pricing_source still describe the price rule
-- (the markup or fixed price that produced computed_selling_price).
--
-- Existing data does not change: every MRP starts NULL, so every price is
-- what it was. The views are dropped and recreated (variant view first: it
-- depends on v_product_catalog).

ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp NUMERIC(12, 2);
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_mrp;
ALTER TABLE products ADD CONSTRAINT chk_products_mrp CHECK (mrp IS NULL OR mrp > 0);

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS mrp NUMERIC(12, 2);
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS chk_product_variants_mrp;
ALTER TABLE product_variants ADD CONSTRAINT chk_product_variants_mrp CHECK (mrp IS NULL OR mrp > 0);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS mrp_snapshot NUMERIC(12, 2);

DROP VIEW IF EXISTS v_product_variant_catalog;
DROP VIEW IF EXISTS v_product_catalog;

-- ----------------------------------------------------------------------------
-- v_product_catalog (045 columns unchanged except the cap; 048 appended)
-- ----------------------------------------------------------------------------
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
    -- Migration 048: capped at the MRP.
    (LEAST(rp.computed, p.mrp))::NUMERIC AS calculated_selling_price,
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
    END)::TEXT AS pricing_source,
    p.delivery_lead_days::INTEGER AS delivery_lead_days,
    (vs.live_variants > 0) AS has_variants,
    (st.tracking_mode IS NOT DISTINCT FROM 'TRACKED') AS stock_tracked,
    (CASE WHEN st.tracking_mode = 'TRACKED' THEN st.quantity_sellable END)::INTEGER AS stock_sellable,
    (p.is_active AND p.is_available AND
        CASE
            WHEN vs.live_variants > 0 THEN vs.orderable_variants > 0
            ELSE (st.tracking_mode IS DISTINCT FROM 'TRACKED' OR st.quantity_sellable > 0)
        END) AS is_orderable,
    -- Migration 048.
    p.mrp,
    rp.computed::NUMERIC AS computed_selling_price,
    (p.mrp IS NOT NULL AND rp.computed > p.mrp) AS mrp_capped
FROM products p
JOIN categories c ON p.category_id = c.id
LEFT JOIN categories pc ON pc.id = c.parent_id AND pc.deleted_at IS NULL
LEFT JOIN LATERAL (
    SELECT COALESCE(
        (SELECT (cfg.value->>'markup_percent')::NUMERIC FROM system_configurations cfg WHERE cfg.key = 'default_markup'),
        20.00
    ) AS markup_percent
) gm ON true
-- The price rule before the cap (migration 044).
LEFT JOIN LATERAL (
    SELECT (CASE
        WHEN p.pricing_mode = 'FIXED' THEN p.fixed_selling_price
        ELSE ROUND(
            p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, c.markup_percent, pc.markup_percent, gm.markup_percent) / 100.0)),
            2
        )
    END)::NUMERIC AS computed
) rp ON true
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
LEFT JOIN LATERAL (
    SELECT s.tracking_mode, s.quantity_sellable
    FROM v_inventory_stock s
    WHERE s.product_id = p.id
      AND s.variant_id IS NULL
      AND s.dark_store_id = (SELECT ds.id FROM dark_stores ds WHERE ds.is_active ORDER BY ds.created_at, ds.id LIMIT 1)
    LIMIT 1
) st ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS live_variants,
        COUNT(*) FILTER (
            WHERE v.is_active AND v.is_available
              AND (vst.tracking_mode IS DISTINCT FROM 'TRACKED' OR vst.quantity_sellable > 0)
        ) AS orderable_variants
    FROM product_variants v
    LEFT JOIN LATERAL (
        SELECT s.tracking_mode, s.quantity_sellable
        FROM v_inventory_stock s
        WHERE s.variant_id = v.id
          AND s.dark_store_id = (SELECT ds.id FROM dark_stores ds WHERE ds.is_active ORDER BY ds.created_at, ds.id LIMIT 1)
        LIMIT 1
    ) vst ON true
    WHERE v.product_id = p.id AND v.deleted_at IS NULL
) vs ON true
WHERE p.deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- v_product_variant_catalog (045 columns unchanged except the cap; 048 appended)
-- ----------------------------------------------------------------------------
CREATE VIEW v_product_variant_catalog AS
SELECT
    v.id,
    v.product_id,
    v.label,
    v.sku,
    v.barcode,
    v.sort_order,
    v.purchase_cost,
    v.pricing_mode,
    v.fixed_selling_price,
    v.custom_markup_percent,
    vp.custom_markup_percent AS product_markup_percent,
    vp.category_markup_percent,
    vp.parent_category_markup_percent,
    vp.global_markup_percent,
    (CASE
        WHEN v.pricing_mode = 'FIXED' THEN
            CASE WHEN v.purchase_cost > 0
                 THEN ROUND((v.fixed_selling_price / v.purchase_cost - 1) * 100, 2)
            END
        ELSE COALESCE(v.custom_markup_percent, vp.custom_markup_percent, vp.category_markup_percent,
                      vp.parent_category_markup_percent, vp.global_markup_percent)
    END)::NUMERIC AS effective_markup_percent,
    -- Migration 048: capped at the size's own MRP.
    (LEAST(rp.computed, v.mrp))::NUMERIC AS calculated_selling_price,
    (CASE
        WHEN v.pricing_mode = 'FIXED' THEN 'FIXED'
        WHEN v.custom_markup_percent IS NOT NULL THEN 'VARIANT_MARKUP'
        WHEN vp.custom_markup_percent IS NOT NULL THEN 'PRODUCT_MARKUP'
        WHEN vp.category_markup_percent IS NOT NULL THEN 'CATEGORY_MARKUP'
        WHEN vp.parent_category_markup_percent IS NOT NULL THEN 'PARENT_CATEGORY_MARKUP'
        ELSE 'GLOBAL_MARKUP'
    END)::TEXT AS pricing_source,
    v.offer_price,
    v.offer_ends_at,
    vp.category_offer_percent,
    vp.category_offer_ends_at,
    v.is_active,
    v.is_available,
    vp.is_active AS product_is_active,
    vp.is_available AS product_is_available,
    vp.delivery_lead_days,
    v.created_at,
    v.updated_at,
    (vst.tracking_mode IS NOT DISTINCT FROM 'TRACKED') AS stock_tracked,
    (CASE WHEN vst.tracking_mode = 'TRACKED' THEN vst.quantity_sellable END)::INTEGER AS stock_sellable,
    (vp.is_active AND vp.is_available AND v.is_active AND v.is_available
        AND (vst.tracking_mode IS DISTINCT FROM 'TRACKED' OR vst.quantity_sellable > 0)) AS is_orderable,
    -- Migration 048.
    v.mrp,
    rp.computed::NUMERIC AS computed_selling_price,
    (v.mrp IS NOT NULL AND rp.computed > v.mrp) AS mrp_capped
FROM product_variants v
JOIN v_product_catalog vp ON vp.id = v.product_id
-- The price rule before the cap (migration 045).
LEFT JOIN LATERAL (
    SELECT (CASE
        WHEN v.pricing_mode = 'FIXED' THEN v.fixed_selling_price
        ELSE ROUND(
            v.purchase_cost * (1 + (COALESCE(v.custom_markup_percent, vp.custom_markup_percent, vp.category_markup_percent,
                                             vp.parent_category_markup_percent, vp.global_markup_percent) / 100.0)),
            2
        )
    END)::NUMERIC AS computed
) rp ON true
LEFT JOIN LATERAL (
    SELECT s.tracking_mode, s.quantity_sellable
    FROM v_inventory_stock s
    WHERE s.variant_id = v.id
      AND s.dark_store_id = (SELECT ds.id FROM dark_stores ds WHERE ds.is_active ORDER BY ds.created_at, ds.id LIMIT 1)
    LIMIT 1
) vst ON true
WHERE v.deleted_at IS NULL;
