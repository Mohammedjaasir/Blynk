-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 026: sub-categories
-- ============================================================================
-- 2026-10-05. A category can sit inside another one ("Bakery" -> Bread,
-- Cakes, Buns). Tapping Bakery on the customer home opens a screen whose
-- sidebar lists Bakery's own sub-categories, the way Blinkit does.
--
-- * categories.parent_id: nullable, ON DELETE SET NULL (a hard-deleted
--   parent just releases its children to the top level). A soft-deleted
--   parent (migration 017) releases them in the delete itself.
-- * ONE level only: a category with a parent cannot be a parent, and a
--   category cannot be its own parent. The API enforces both (400); the
--   CHECK below is the last line for the second.
-- * Listing products by a parent's slug includes its children's products.
-- * The home (groups and fallback) shows top-level categories only; the
--   children are reached through their parent.
-- * The migration 011 trigger on categories already NOTIFYs catalog_changed.

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS parent_id UUID NULL REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_parent_not_self;
ALTER TABLE categories
    ADD CONSTRAINT chk_categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);

CREATE INDEX IF NOT EXISTS idx_categories_parent
    ON categories (parent_id) WHERE deleted_at IS NULL;
