-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 047: PayHere online payments
-- ============================================================================
-- Owner, 2026-10-14: customers may "Pay online" through PayHere while staff
-- have it switched on (Admin + Ops; credentials Admin only). Cash on delivery
-- stays the default and is unchanged.
--
-- 1. order_status_enum gains AWAITING_PAYMENT: an ONLINE order is created in
--    it and is NOT packable until PayHere's verified notification moves it to
--    PLACED (lifecycle PAYMENT_CONFIRMED). Unpaid orders past
--    orders.payment_expires_at are cancelled (lifecycle PAYMENT_EXPIRED).
--    PostgreSQL 12+ allows ADD VALUE inside the migration transaction as long
--    as nothing in the same transaction uses the new value - nothing here does.
-- 2. payment_gateway_settings: one row per provider (only 'PAYHERE'). The
--    merchant secret is stored ENCRYPTED (AES-256-GCM, key from the
--    PAYMENT_SECRET_KEY environment variable) and is never returned by the API.
-- 3. payments gains the gateway's identifiers and outcome (no card data).
-- 4. payment_notifications: every notify_url call, verified or not, for audit
--    and idempotency checks. No card numbers, no secret, no md5sig.

ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT' BEFORE 'PLACED';

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
    provider VARCHAR(16) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    mode VARCHAR(8) NOT NULL DEFAULT 'sandbox',
    merchant_id VARCHAR(32),
    merchant_secret_encrypted TEXT,
    merchant_secret_updated_at TIMESTAMPTZ,
    allowed_methods VARCHAR(200),
    payment_window_minutes INTEGER NOT NULL DEFAULT 20,
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pgs_provider CHECK (provider IN ('PAYHERE')),
    CONSTRAINT chk_pgs_mode CHECK (mode IN ('sandbox', 'live')),
    CONSTRAINT chk_pgs_window CHECK (payment_window_minutes BETWEEN 5 AND 180)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
    ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway VARCHAR(16);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_payment_id VARCHAR(64);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_status_code SMALLINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_method VARCHAR(32);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_status_message TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(16) NOT NULL DEFAULT 'PAYHERE',
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    gateway_order_id VARCHAR(64),
    gateway_payment_id VARCHAR(64),
    status_code SMALLINT,
    amount NUMERIC(10, 2),
    currency VARCHAR(8),
    method VARCHAR(32),
    signature_valid BOOLEAN NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_order ON payment_notifications (order_id, received_at);
