-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 045: product variants, customer-hidden stock control, delivery
-- lead time
-- ============================================================================
-- Owner, 2026-10-14:
--   A. "chilli powder has 50g, 100g, 250g, 500g with different prices";
--      "grams with prices, pieces with prices, some items have 3-packs";
--      "show LKR 50-350, then the proper price for the gram they pick".
--   B. "set up a stock count in the product edit; it should not show to the
--      customer; low stock I must see from Ops; out of stock they can't
--      order" (customers can order until stock reaches 0).
--   C. "items that can only be delivered after two days or some days".
-- Everything is controllable in BOTH Admin and Ops.
--
-- * product_variants: a product's sizes/packs. Each has its own label, an
--   optional SKU/barcode, a sort order, its own purchase cost and pricing
--   (FIXED price, or MARKUP: the variant's own markup, else the product's
--   custom markup, else category / parent category / global - the migration
--   044 rule), an optional offer price, and active/available switches.
--   Deleted variants that were ordered are soft-deleted (deleted_at), like
--   products (migration 017). A product without live variants works exactly
--   as before.
-- * products.delivery_lead_days SMALLINT NOT NULL DEFAULT 0 (0..30): the
--   earliest delivery is today + N days (0 = same day / as soon as
--   possible). Variants inherit their product's lead time.
-- * inventory.variant_id: a variant's stock is its own inventory row (same
--   ledger, same writer, same tracked/untracked switch). The old
--   UNIQUE (dark_store_id, product_id) becomes two partial unique indexes:
--   one product-level row (variant_id NULL) and one row per variant per
--   store. A composite FK keeps a variant row on its own product.
-- * order_items.variant_id / variant_label_snapshot: the variant ordered and
--   its label at the time ("Chilli powder - 100 g").
-- * combo_items.variant_id: a combo may hold a specific variant. The primary
--   key (combo_id, product_id) becomes a surrogate id plus a unique index on
--   (combo_id, product_id, variant_id) so two sizes of one product can sit
--   in one combo.
-- * v_inventory_stock: every inventory row with quantity_in_open_orders (the
--   units in orders not yet packed: PENDING items of PLACED/ITEM_UNAVAILABLE
--   orders - stock leaves the shelf at pack/sourcing) and
--   quantity_sellable = on hand - reserved - in open orders. "Can order
--   until stock reaches 0" is quantity_sellable >= what the cart wants.
-- * v_product_catalog gains (appended; every earlier column unchanged):
--   delivery_lead_days, has_variants, stock_tracked, stock_sellable,
--   is_orderable. stock_* are staff-only; customers get is_orderable as
--   is_available (never a count).
-- * v_product_variant_catalog: each live variant of a live product, priced
--   with the same rule as v_product_catalog (pricing/index.ts
--   resolveVariantPrice is its TypeScript twin), with its stock and
--   is_orderable.
--
-- Existing data does not change: no product has variants, every inventory
-- row stays the product-level row (variant_id NULL), every order item keeps
-- variant_id NULL, every lead time is 0 and every combo item keeps its
-- product. NOTE: v_product_variant_catalog depends on v_product_catalog; a
-- later migration that drops v_product_catalog must drop it first.

-- ----------------------------------------------------------------------------
-- 1. Variants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label VARCHAR(64) NOT NULL,
    sku VARCHAR(64),
    barcode VARCHAR(64),
    sort_order INTEGER NOT NULL DEFAULT 0,
    purchase_cost NUMERIC(10, 2) NOT NULL,
    pricing_mode TEXT NOT NULL DEFAULT 'MARKUP',
    fixed_selling_price NUMERIC(12, 2),
    custom_markup_percent NUMERIC(5, 2),
    offer_price NUMERIC(10, 2),
    offer_ends_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_product_variants_id_product UNIQUE (id, product_id),
    CONSTRAINT chk_product_variants_label CHECK (length(btrim(label)) >= 1),
    CONSTRAINT chk_product_variants_cost CHECK (purchase_cost >= 0),
    CONSTRAINT chk_product_variants_pricing_mode CHECK (pricing_mode IN ('MARKUP', 'FIXED')),
    CONSTRAINT chk_product_variants_fixed_price CHECK (fixed_selling_price IS NULL OR fixed_selling_price >= 0),
    CONSTRAINT chk_product_variants_fixed_mode_has_price
        CHECK (pricing_mode <> 'FIXED' OR (fixed_selling_price IS NOT NULL AND fixed_selling_price > 0)),
    CONSTRAINT chk_product_variants_markup
        CHECK (custom_markup_percent IS NULL OR (custom_markup_percent >= 0 AND custom_markup_percent <= 999.99)),
    CONSTRAINT chk_product_variants_offer CHECK (offer_price IS NULL OR offer_price > 0),
    CONSTRAINT chk_product_variants_sort CHECK (sort_order >= 0)
);

-- One live variant per label per product ('100g' and '100G' are the same).
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_label
    ON product_variants (product_id, lower(btrim(label))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku
    ON product_variants (sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product
    ON product_variants (product_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode
    ON product_variants (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

-- Open customer apps refresh when a variant changes (migration 011).
DROP TRIGGER IF EXISTS trg_product_variants_catalog_changed ON product_variants;
CREATE TRIGGER trg_product_variants_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON product_variants
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

-- ----------------------------------------------------------------------------
-- 2. Delivery lead time
-- ----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_lead_days SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_delivery_lead_days;
ALTER TABLE products ADD CONSTRAINT chk_products_delivery_lead_days
    CHECK (delivery_lead_days BETWEEN 0 AND 30);

-- ----------------------------------------------------------------------------
-- 3. Variant stock (inventory rows)
-- ----------------------------------------------------------------------------
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS fk_inventory_variant;
ALTER TABLE inventory ADD CONSTRAINT fk_inventory_variant
    FOREIGN KEY (variant_id, product_id) REFERENCES product_variants (id, product_id) ON DELETE CASCADE;

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS uq_inventory_store_product;
DROP INDEX IF EXISTS idx_inventory_store_product;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_store_product_base
    ON inventory (dark_store_id, product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_store_variant
    ON inventory (dark_store_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory (product_id);

-- ----------------------------------------------------------------------------
-- 4. Orders and combos reference a variant
-- ----------------------------------------------------------------------------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_label_snapshot VARCHAR(64);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS fk_order_items_variant;
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_variant
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL;
-- Units not yet taken from the shelf (v_inventory_stock).
CREATE INDEX IF NOT EXISTS idx_order_items_pending_stock
    ON order_items (product_id, variant_id) WHERE item_status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items (variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE combo_items ADD COLUMN IF NOT EXISTS variant_id UUID;
ALTER TABLE combo_items DROP CONSTRAINT IF EXISTS fk_combo_items_variant;
ALTER TABLE combo_items ADD CONSTRAINT fk_combo_items_variant
    FOREIGN KEY (variant_id, product_id) REFERENCES product_variants (id, product_id) ON DELETE CASCADE;
ALTER TABLE combo_items ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE combo_items DROP CONSTRAINT IF EXISTS combo_items_pkey;
ALTER TABLE combo_items ADD CONSTRAINT combo_items_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_items_product_variant
    ON combo_items (combo_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ----------------------------------------------------------------------------
-- 5. Sellable stock
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_product_variant_catalog;
DROP VIEW IF EXISTS v_product_catalog;
DROP VIEW IF EXISTS v_inventory_stock;

CREATE VIEW v_inventory_stock AS
SELECT
    inv.id AS inventory_id,
    inv.dark_store_id,
    inv.product_id,
    inv.variant_id,
    inv.tracking_mode,
    inv.quantity_on_hand,
    inv.quantity_reserved,
    inv.low_stock_threshold,
    inv.updated_at,
    COALESCE(open_orders.quantity, 0)::INTEGER AS quantity_in_open_orders,
    (inv.quantity_on_hand - inv.quantity_reserved - COALESCE(open_orders.quantity, 0))::INTEGER AS quantity_sellable
FROM inventory inv
LEFT JOIN LATERAL (
    SELECT SUM(oi.quantity) AS quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = inv.product_id
      AND oi.variant_id IS NOT DISTINCT FROM inv.variant_id
      AND oi.item_status = 'PENDING'
      AND o.order_status IN ('PLACED', 'ITEM_UNAVAILABLE')
      AND o.dark_store_id = inv.dark_store_id
) open_orders ON true;

-- ----------------------------------------------------------------------------
-- 6. v_product_catalog (044 columns unchanged, 045 columns appended)
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
    END)::TEXT AS pricing_source,
    -- Migration 045.
    p.delivery_lead_days::INTEGER AS delivery_lead_days,
    (vs.live_variants > 0) AS has_variants,
    (st.tracking_mode IS NOT DISTINCT FROM 'TRACKED') AS stock_tracked,
    (CASE WHEN st.tracking_mode = 'TRACKED' THEN st.quantity_sellable END)::INTEGER AS stock_sellable,
    (p.is_active AND p.is_available AND
        CASE
            WHEN vs.live_variants > 0 THEN vs.orderable_variants > 0
            ELSE (st.tracking_mode IS DISTINCT FROM 'TRACKED' OR st.quantity_sellable > 0)
        END) AS is_orderable
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
-- 7. v_product_variant_catalog
-- ----------------------------------------------------------------------------
-- Price rule (pricing/index.ts resolveVariantPrice):
--   FIXED  -> the variant's fixed_selling_price
--   MARKUP -> ROUND(variant cost x (1 + m / 100), 2) with
--             m = COALESCE(variant custom markup, product custom markup,
--                          category, parent category, global)
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
    (CASE
        WHEN v.pricing_mode = 'FIXED' THEN v.fixed_selling_price
        ELSE ROUND(
            v.purchase_cost * (1 + (COALESCE(v.custom_markup_percent, vp.custom_markup_percent, vp.category_markup_percent,
                                             vp.parent_category_markup_percent, vp.global_markup_percent) / 100.0)),
            2
        )
    END)::NUMERIC AS calculated_selling_price,
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
        AND (vst.tracking_mode IS DISTINCT FROM 'TRACKED' OR vst.quantity_sellable > 0)) AS is_orderable
FROM product_variants v
JOIN v_product_catalog vp ON vp.id = v.product_id
LEFT JOIN LATERAL (
    SELECT s.tracking_mode, s.quantity_sellable
    FROM v_inventory_stock s
    WHERE s.variant_id = v.id
      AND s.dark_store_id = (SELECT ds.id FROM dark_stores ds WHERE ds.is_active ORDER BY ds.created_at, ds.id LIMIT 1)
    LIMIT 1
) vst ON true
WHERE v.deleted_at IS NULL;
