-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 005: Promotion background control
-- ============================================================================
-- The Home carousel previously picked its own tint from a hardcoded palette
-- in the Flutter app, which meant the customer-facing look of a campaign was
-- not something operations could set. These columns move that decision into
-- the promotion itself:
--
--   SOLID    -> background_color
--   GRADIENT -> background_color + background_color_end
--   IMAGE    -> background_image_url (foreground image_url still layers on top)
--
-- Existing rows default to SOLID with no colour, which the app renders with
-- its neutral surface - no visual change until someone sets one.

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS background_type VARCHAR(16) NOT NULL DEFAULT 'SOLID'
        CHECK (background_type IN ('SOLID', 'GRADIENT', 'IMAGE')),
    ADD COLUMN IF NOT EXISTS background_color VARCHAR(9),
    ADD COLUMN IF NOT EXISTS background_color_end VARCHAR(9),
    ADD COLUMN IF NOT EXISTS background_image_url TEXT;
