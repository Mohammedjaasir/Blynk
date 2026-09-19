-- ============================================================================
-- Migration 005 DOWN: Promotion background control
-- ============================================================================

ALTER TABLE promotions
    DROP COLUMN IF EXISTS background_type,
    DROP COLUMN IF EXISTS background_color,
    DROP COLUMN IF EXISTS background_color_end,
    DROP COLUMN IF EXISTS background_image_url;
