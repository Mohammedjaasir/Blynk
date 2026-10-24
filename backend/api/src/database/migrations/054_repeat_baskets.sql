-- ============================================================================
-- Migration 054: repeat baskets ("deliver this basket every Monday")
-- ============================================================================
-- Owner, 2026-10-24: "'Buy again' and repeat baskets: a Buy again list on Home,
-- and 'deliver this basket every Monday' or a daily milk and bread
-- subscription". Contract: docs/superpowers/plans/2026-10-24-buy-again-repeat.md.
-- A customer saves a basket (products/sizes and quantities), how often
-- (every day / every week on a weekday / every 2 weeks) and the Colombo time
-- the order is placed. The worker (modules/repeat-baskets/repeat.runner.ts)
-- places a normal cash-on-delivery, as-soon-as-possible order as the customer
-- at that time through the usual order service (prices, offers, delivery fee,
-- free deliveries, availability windows and stock all apply).
--
--   repeat_baskets           one per saved basket (at most 5 not cancelled per customer, API rule)
--   repeat_basket_runs       every time a basket was due: PLACED / SKIPPED / FAILED and why
--   orders.repeat_basket_id  the basket an order came from (NULL = an ordinary order)
--
-- The API is deployed before this runs (migrations are run by hand in
-- Coolify): it checks for these tables and answers 503 REPEAT_NOT_READY (and
-- GET /store says repeat_baskets_enabled false) until they exist.

CREATE TABLE IF NOT EXISTS repeat_baskets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(40)  NOT NULL DEFAULT 'My basket',
    -- [{product_id, variant_id|null, quantity 1-20}], 1-30 lines (shape checked by the API)
    items         JSONB        NOT NULL,
    frequency     VARCHAR(10)  NOT NULL,
    -- 0 = Sunday ... 6 = Saturday; required for WEEKLY / BIWEEKLY, NULL for DAILY
    weekday       SMALLINT     NULL,
    -- 'HH:MM' Asia/Colombo: when the order is placed
    place_at      VARCHAR(5)   NOT NULL,
    -- the first day it may run (Colombo); NULL = from when it was saved
    start_date    DATE         NULL,
    address_id    UUID         NULL REFERENCES customer_addresses(id) ON DELETE SET NULL,
    notes         VARCHAR(300) NULL,
    status        VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
    skip_next     BOOLEAN      NOT NULL DEFAULT false,
    -- the next time the worker places it; NULL while PAUSED / CANCELLED
    next_run_at   TIMESTAMPTZ  NULL,
    last_run_at   TIMESTAMPTZ  NULL,
    last_order_id UUID         NULL REFERENCES orders(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_repeat_baskets_items CHECK (
        jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 30),
    CONSTRAINT chk_repeat_baskets_frequency CHECK (frequency IN ('DAILY', 'WEEKLY', 'BIWEEKLY')),
    CONSTRAINT chk_repeat_baskets_weekday CHECK (
        (weekday IS NULL OR weekday BETWEEN 0 AND 6) AND (frequency = 'DAILY' OR weekday IS NOT NULL)),
    CONSTRAINT chk_repeat_baskets_place_at CHECK (place_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT chk_repeat_baskets_status CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED')),
    CONSTRAINT chk_repeat_baskets_name CHECK (length(btrim(name)) >= 1)
);
-- the worker's queue: active baskets by when they are due
CREATE INDEX IF NOT EXISTS idx_repeat_baskets_due ON repeat_baskets (next_run_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_repeat_baskets_user ON repeat_baskets (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_repeat_baskets_status ON repeat_baskets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS repeat_basket_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    basket_id   UUID NOT NULL REFERENCES repeat_baskets(id) ON DELETE CASCADE,
    -- the next_run_at that was due (one run per due time)
    run_at      TIMESTAMPTZ  NOT NULL,
    status      VARCHAR(10)  NOT NULL,
    order_id    UUID         NULL REFERENCES orders(id) ON DELETE SET NULL,
    reason      VARCHAR(300) NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_repeat_basket_runs_status CHECK (status IN ('PLACED', 'SKIPPED', 'FAILED')),
    CONSTRAINT uq_repeat_basket_runs_due UNIQUE (basket_id, run_at)
);
CREATE INDEX IF NOT EXISTS idx_repeat_basket_runs_basket ON repeat_basket_runs (basket_id, run_at DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS repeat_basket_id UUID NULL REFERENCES repeat_baskets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_repeat_basket ON orders (repeat_basket_id) WHERE repeat_basket_id IS NOT NULL;
