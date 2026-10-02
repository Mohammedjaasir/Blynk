-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 022: app push notifications (Firebase Cloud Messaging)
-- ============================================================================
-- Phase 6 (2026-10-02). The customer app receives order updates and
-- "back in stock" alerts as push notifications.
--
-- * notifications.channel gains 'PUSH'. A PUSH outbox row's recipient is the
--   user id; the worker sends it to every device that user has registered.
--   (The new enum value is only added here, never used in this transaction.)
-- * device_tokens: one row per FCM registration token. A token belongs to
--   whoever registered it last (a shared phone that changes account moves
--   its token). Tokens FCM reports as unregistered or invalid are deleted by
--   the worker.
-- * stock_alerts: "Notify me when it's back" on a sold-out product. Pending
--   while notified_at IS NULL; the alert fires once, sets notified_at, and a
--   customer who asks again starts a new pending alert on the same row.

ALTER TYPE notification_channel_enum ADD VALUE IF NOT EXISTS 'PUSH';

CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 1 AND 4096),
    platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id);

CREATE TABLE IF NOT EXISTS stock_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notified_at TIMESTAMPTZ,
    UNIQUE (user_id, product_id)
);

-- Releasing a product's alerts reads its pending subscribers.
CREATE INDEX IF NOT EXISTS idx_stock_alerts_pending
    ON stock_alerts (product_id) WHERE notified_at IS NULL;
