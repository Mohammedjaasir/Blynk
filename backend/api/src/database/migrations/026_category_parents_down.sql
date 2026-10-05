-- Migration 026 DOWN: drop sub-categories (every category becomes top level).
DROP INDEX IF EXISTS idx_categories_parent;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_parent_not_self;
ALTER TABLE categories DROP COLUMN IF EXISTS parent_id;
