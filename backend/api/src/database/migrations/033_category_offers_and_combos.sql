-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 033: category offers and combo packs
-- ============================================================================
-- 2026-10-09 (owner): "Category wise offers, bundle offers".
--
-- 1. CATEGORY OFFER - a % off everything in a category, optionally until a
--    date (e.g. 10% off everything in Bakery until Sunday), set in Ops and
--    Admin on the category.
--    * categories.offer_percent NUMERIC(5,2) NULL - NULL means no offer;
--      otherwise strictly between 0 and 100 (CHECK).
--    * categories.offer_ends_at TIMESTAMPTZ NULL - NULL runs until removed.
--    * A product's category offer is the larger ACTIVE offer of its own
--      category and that category's parent (migration 026: one level), so a
--      Bakery offer covers Bakery > Buns too. v_product_catalog gains
--      category_offer_percent / category_offer_ends_at at the end (the
--      columns before them unchanged), already filtered to active offers.
--    * The customer pays the LOWER of the product's own offer (migration 031)
--      and the category price; src/modules/catalog/catalog.offers.ts holds
--      that single rule. Nothing is written when an offer ends.
--
-- 2. COMBO PACK - staff pick products (with quantities) into a named combo
--    at one combo price, e.g. "Breakfast pack: bread + eggs + milk".
--    * combos: the pack (name, description, image, price > 0, active switch,
--      optional end date, display order). Soft-deleted (deleted_at) so a
--      combo in order history keeps its row.
--    * combo_items: which products and how many of each, one row per
--      product. A product hard-deleted from the catalog leaves the combo
--      (CASCADE); a soft-deleted one is inactive, which makes the combo
--      unavailable.
--    * order_combos: a combo as ordered - name, price and quantity
--      snapshotted like order_items snapshots a product.
--    * order_items.order_combo_id: the combo line an item was packed for.
--      A combo in an order is ordinary order_items rows (one per product,
--      quantity x combo quantity) whose unit prices share the combo price, so
--      packing, stock (taken at pack, restored on cancel), item resolution,
--      reports and cash work on them unchanged. NULL for loose items.
--    * combos and combo_items NOTIFY catalog_changed (migration 011), so open
--      customer homes refresh when a combo changes.

-- ----------------------------------------------------------------------------
-- 1. Category offers
-- ----------------------------------------------------------------------------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS offer_percent NUMERIC(5,2);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS offer_ends_at TIMESTAMPTZ;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_offer_percent;
ALTER TABLE categories ADD CONSTRAINT chk_categories_offer_percent
  CHECK (offer_percent IS NULL OR (offer_percent > 0 AND offer_percent < 100));

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

-- ----------------------------------------------------------------------------
-- 2. Combo packs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS combos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    description TEXT,
    image_url TEXT,
    price NUMERIC(10,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    ends_at TIMESTAMPTZ,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_combos_price_positive CHECK (price > 0)
);

CREATE TABLE IF NOT EXISTS combo_items (
    combo_id UUID NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (combo_id, product_id),
    CONSTRAINT chk_combo_items_quantity CHECK (quantity BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_combo_items_product ON combo_items(product_id);

CREATE TABLE IF NOT EXISTS order_combos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    combo_id UUID REFERENCES combos(id) ON DELETE SET NULL,
    combo_name_snapshot VARCHAR(120) NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL,
    -- What one pack's items cost at their own prices when ordered ("Saved LKR X").
    items_regular_total NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_order_combos_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_combos_price CHECK (unit_price > 0),
    CONSTRAINT chk_order_combos_subtotal CHECK (subtotal = unit_price * quantity)
);
CREATE INDEX IF NOT EXISTS idx_order_combos_order ON order_combos(order_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS order_combo_id UUID REFERENCES order_combos(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_order_items_order_combo ON order_items(order_combo_id) WHERE order_combo_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_combos_catalog_changed ON combos;
CREATE TRIGGER trg_combos_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON combos
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

DROP TRIGGER IF EXISTS trg_combo_items_catalog_changed ON combo_items;
CREATE TRIGGER trg_combo_items_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON combo_items
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
