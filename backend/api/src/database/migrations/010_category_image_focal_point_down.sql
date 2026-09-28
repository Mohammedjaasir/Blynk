-- Migration 010 DOWN: drops the category focal point. Every category image
-- goes back to being cropped from the centre, as it was before 010.
ALTER TABLE categories
    DROP CONSTRAINT IF EXISTS chk_category_image_focal_x,
    DROP CONSTRAINT IF EXISTS chk_category_image_focal_y;
ALTER TABLE categories
    DROP COLUMN IF EXISTS image_focal_x,
    DROP COLUMN IF EXISTS image_focal_y;
