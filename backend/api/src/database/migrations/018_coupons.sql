-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 018: coupon codes
-- ============================================================================
-- Admin creates codes on the Admin site; the customer applies one at
-- checkout. The order snapshots what it got (orders.coupon_code,
-- orders.discount_amount), so editing or switching off a coupon later never
-- changes an order already placed.
--
-- * coupons.code is stored upper-case (A-Z, 0-9, 4-20 characters), so the
--   plain UNIQUE is case-insensitive in effect; the API upper-cases input.
-- * discount_type: FIXED (discount_value LKR off), PERCENT (discount_value
--   1-100 %, optionally capped by max_discount) or FREE_DELIVERY (the
--   delivery fee is waived; discount_value is 0).
-- * per_customer_limit defaults to 1; usage_limit NULL means unlimited.
-- * coupon_redemptions: one row per order that used a code. Cancelling the
--   order sets released_at, which gives the use back (limits count only
--   unreleased rows). The row is kept for the audit trail. It goes with its
--   order (ON DELETE CASCADE).
-- * orders.total_amount = subtotal + delivery_fee - discount_amount, and a
--   total is never negative. The COD cash to collect is the total.

CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    discount_type TEXT NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
    max_discount NUMERIC(10, 2),
    min_subtotal NUMERIC(10, 2),
    first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    usage_limit INTEGER,
    per_customer_limit INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_coupon_code CHECK (code ~ '^[A-Z0-9]{4,20}$'),
    CONSTRAINT chk_coupon_type CHECK (discount_type IN ('FIXED', 'PERCENT', 'FREE_DELIVERY')),
    CONSTRAINT chk_coupon_value CHECK (
        (discount_type = 'FIXED' AND discount_value > 0)
        OR (discount_type = 'PERCENT' AND discount_value >= 1 AND discount_value <= 100)
        OR (discount_type = 'FREE_DELIVERY' AND discount_value = 0)
    ),
    CONSTRAINT chk_coupon_max_discount CHECK (max_discount IS NULL OR (discount_type = 'PERCENT' AND max_discount > 0)),
    CONSTRAINT chk_coupon_min_subtotal CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
    CONSTRAINT chk_coupon_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT chk_coupon_usage_limit CHECK (usage_limit IS NULL OR usage_limit > 0),
    CONSTRAINT chk_coupon_per_customer CHECK (per_customer_limit > 0)
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discount_amount NUMERIC(10, 2) NOT NULL CHECK (discount_amount >= 0),
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_live
    ON coupon_redemptions (coupon_id, customer_id) WHERE released_at IS NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(20);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_discount CHECK (discount_amount >= 0.00);
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount);
ALTER TABLE orders ADD CONSTRAINT chk_order_total_nonnegative CHECK (total_amount >= 0.00);
