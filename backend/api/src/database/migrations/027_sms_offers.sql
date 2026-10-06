-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 027: SMS offers to registered customers
-- ============================================================================
-- 2026-10-06 (owner). Admin and Operations send offers by SMS to registered
-- customers, in each customer's own language (Sinhala, Tamil or English).
--
-- * users.sms_language: 'si' | 'ta' | 'en', NULL until the customer picks
--   one in the app; NULL customers get the offer's fallback language.
-- * users.sms_offers_opted_out_at: set when the customer turns "Offers by
--   SMS" off. Everyone gets offers until they opt out (owner decision);
--   every offer SMS ends with a line saying how to turn them off.
-- * sms_offers: one row per offer sent (who, to whom, the texts). Each
--   recipient's SMS is a row in the existing notifications outbox
--   (notification_type 'SMS_OFFER'), so the worker's retries apply.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_language VARCHAR(2) NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_sms_language;
ALTER TABLE users
    ADD CONSTRAINT chk_users_sms_language CHECK (sms_language IS NULL OR sms_language IN ('si', 'ta', 'en'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_offers_opted_out_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS sms_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    audience VARCHAR(32) NOT NULL,
    fallback_language VARCHAR(2) NOT NULL,
    message_si TEXT NULL,
    message_ta TEXT NULL,
    message_en TEXT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    sms_parts_total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sms_offers_audience CHECK (audience IN ('ALL', 'ORDERED_30D', 'ORDERED_90D', 'NEVER_ORDERED')),
    CONSTRAINT chk_sms_offers_fallback CHECK (fallback_language IN ('si', 'ta', 'en'))
);

CREATE INDEX IF NOT EXISTS idx_sms_offers_created ON sms_offers (created_at DESC);
