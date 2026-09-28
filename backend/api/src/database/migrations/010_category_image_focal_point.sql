-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 010: Category image focal point
-- ============================================================================
-- Category tiles crop their uploaded image to fill a fixed shape, exactly as
-- product tiles do (migration 009). Operators could upload a category image
-- but not say which part of it must stay visible, so an off-centre subject
-- was cropped away. Same two percentages as products; same default (50/50,
-- the centre), so every existing category renders exactly as it does now.

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS image_focal_x SMALLINT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS image_focal_y SMALLINT NOT NULL DEFAULT 50;

ALTER TABLE categories
    DROP CONSTRAINT IF EXISTS chk_category_image_focal_x;
ALTER TABLE categories
    ADD CONSTRAINT chk_category_image_focal_x
        CHECK (image_focal_x BETWEEN 0 AND 100);

ALTER TABLE categories
    DROP CONSTRAINT IF EXISTS chk_category_image_focal_y;
ALTER TABLE categories
    ADD CONSTRAINT chk_category_image_focal_y
        CHECK (image_focal_y BETWEEN 0 AND 100);
