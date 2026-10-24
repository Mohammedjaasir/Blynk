-- ============================================================================
-- Migration 060: a product can be listed in more than one category
-- ============================================================================
-- Owner, 2026-10-25: "a product can be in more than one category" (e.g. Kottu
-- Roti in Rice & Noodles and in Ready to Eat). Decision (wave 2 contract): a
-- product keeps ONE primary category (products.category_id - offers, markup,
-- availability hours, seller commission and the slug all use it) plus up to 5
-- EXTRA categories that are used only for LISTING it: the product then shows
-- in each of those categories' lists and in a parent category that contains
-- one of them as a sub-category, exactly as it does for its primary.
--
--   product_categories(product_id, category_id)
--       extra categories only, never the primary (the API enforces it; a
--       product's primary can change, so this is not a CHECK). Hard-deleting a
--       product or a category removes its rows.
--
-- The API is deployed before this runs (migrations are run by hand in
-- Coolify): it checks for the table and, until it exists, lists products by
-- their primary category only and the staff forms hide the field.

CREATE TABLE IF NOT EXISTS product_categories (
    product_id  UUID        NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
    category_id UUID        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON product_categories (category_id);

-- Open customer apps refresh when a product's categories change (as for
-- products / categories in migration 011).
DROP TRIGGER IF EXISTS trg_product_categories_catalog_changed ON product_categories;
CREATE TRIGGER trg_product_categories_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON product_categories
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
