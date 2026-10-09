-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 031: a product on offer at a reduced price
-- ============================================================================
-- 2026-10-09 (owner). Operations and Admin can put a product on offer, e.g.
-- Rice LKR 250 -> LKR 220. Customers see the regular price struck through
-- and an "Offer" tag; the cart and the order charge the offer price.
--
-- * products.offer_price NUMERIC(10,2) NULL - the reduced price; NULL means
--   no offer. Must be above 0 (CHECK). That it is below the selling price is
--   checked by the API, because the selling price is computed (cost x markup).
-- * products.offer_ends_at TIMESTAMPTZ NULL - when the offer stops; NULL
--   means it runs until someone removes it.
-- * An offer is active while offer_price IS NOT NULL AND (offer_ends_at IS
--   NULL OR offer_ends_at > now()) and it is below the selling price
--   (src/modules/catalog/catalog.offers.ts). Nothing is written when an offer
--   ends; it simply stops applying.
-- * v_product_catalog gains the two columns at the end (same columns in the
--   same order as migration 017 before them), so every product read carries
--   them. Existing rows get NULL: no product is on offer after this runs.

ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_ends_at TIMESTAMPTZ;

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_offer_price_positive;
ALTER TABLE products ADD CONSTRAINT chk_products_offer_price_positive
  CHECK (offer_price IS NULL OR offer_price > 0);

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
    p.offer_ends_at
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup'
  AND p.deleted_at IS NULL;
