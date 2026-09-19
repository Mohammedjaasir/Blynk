-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 004: Home Promotions (admin-managed customer carousel)
-- ============================================================================
-- The customer Home carousel was previously hardcoded in the Flutter app.
-- This table makes the backend the single source of truth: Admin writes
-- here, the customer API reads the active rows in display order.
--
-- Scheduling (start/end windows) is deliberately NOT modelled yet - the
-- business runs promotions on/off manually today, and an unused scheduler
-- would be dead weight in the customer query. See the Phase report.

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(120) NOT NULL,
    subtitle VARCHAR(240),
    image_url TEXT,
    cta_label VARCHAR(40),
    -- Nullable on purpose: a promotion with no destination stays
    -- informational rather than inventing a screen to open.
    cta_destination_type VARCHAR(16)
        CHECK (cta_destination_type IN ('CATEGORY', 'PRODUCT', 'CATALOG')),
    cta_destination_value TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The customer query is always "active, in display order".
CREATE INDEX IF NOT EXISTS idx_promotions_active_order
    ON promotions (is_active, display_order, created_at);

-- This schema has no updated_at triggers; repositories set updated_at
-- explicitly on write, as the other modules do.
