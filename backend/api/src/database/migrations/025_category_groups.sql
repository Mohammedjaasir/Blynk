-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 025: category groups on the customer home
-- ============================================================================
-- 2026-10-05. The customer home shows GROUPS of category tiles ("Grocery &
-- Kitchen" -> Vegetables & Fruits, Dairy, ...) instead of one product shelf
-- per category. Staff (ADMIN, OPERATIONS) manage the groups in Ops and Admin.
--
-- * category_groups: name, sort_order, is_active. Soft delete like the rest
--   of the catalog (migration 017): a deleted group keeps its row with
--   deleted_at set and its categories are released (group_id cleared).
--   Live names are unique, ignoring case.
-- * categories.group_id: nullable, ON DELETE SET NULL (a hard delete - only
--   ever done by hand or by a test - also just releases the categories).
--   Ungrouped categories show in a final "More" group on the home.
-- * categories.group_sort_order: position inside the group.
-- * The migration 011 trigger function also fires for category_groups, so a
--   group change reaches open customer homes at once.

CREATE TABLE IF NOT EXISTS category_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_groups_name_live
    ON category_groups (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_category_groups_sort
    ON category_groups (sort_order) WHERE deleted_at IS NULL;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES category_groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS group_sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_categories_group
    ON categories (group_id, group_sort_order) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_category_groups_catalog_changed ON category_groups;
CREATE TRIGGER trg_category_groups_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON category_groups
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
