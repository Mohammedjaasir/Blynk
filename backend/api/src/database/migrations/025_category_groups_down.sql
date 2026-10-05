-- Migration 025 DOWN: drop category groups and the category columns.
DROP TRIGGER IF EXISTS trg_category_groups_catalog_changed ON category_groups;
DROP INDEX IF EXISTS idx_categories_group;
ALTER TABLE categories DROP COLUMN IF EXISTS group_sort_order;
ALTER TABLE categories DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS category_groups;
