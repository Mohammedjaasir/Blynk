-- ============================================================================
-- Migration 059: expiry dates (stock batches)
-- ============================================================================
-- Owner, 2026-10-25: "expiry dates". A REGISTER of what was received and when it
-- expires, so staff can see "expiring soon" and "expired" in Admin and Ops and
-- throw away what is out of date:
--
--   stock_batches   one row per received batch: product (and variant), an optional
--                   batch code, how many, the expiry date (a calendar date, Colombo),
--                   ACTIVE -> SOLD_OUT | DISCARDED. Discarding an expired batch
--                   reduces the product's stock through the stock writer (a
--                   DAMAGE_WRITE_OFF ledger row) in the same transaction; it
--                   records how many units that took off the shelf count.
--   products.expiry_tracking   the product form's "Track expiry dates" switch
--                   (a hint for staff screens: it never hides or blocks a product).
--
-- Batches are a register, not a stock engine: inventory.quantity_on_hand stays
-- the source of truth and nothing consumes batches automatically (no FEFO), and
-- an expired ACTIVE batch never hides a product by itself.
--
-- The API is deployed before this runs (migrations are run by hand in Coolify):
-- it checks for the table and answers 503 EXPIRY_NOT_READY until it exists.

ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_tracking BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS stock_batches (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id            UUID         NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id            UUID         NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    batch_code            VARCHAR(60)  NULL,
    quantity              INTEGER      NOT NULL,
    -- the last day it may be sold (Asia/Colombo calendar date)
    expires_on            DATE         NOT NULL,
    status                VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
    note                  VARCHAR(300) NULL,
    received_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by            UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
    sold_out_at           TIMESTAMPTZ  NULL,
    discarded_at          TIMESTAMPTZ  NULL,
    discarded_by          UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
    -- EXPIRED | WASTE
    discard_reason        VARCHAR(20)  NULL,
    -- how many units the discard took off the product's stock count (0 when the product is not tracked)
    discard_stock_removed INTEGER      NULL,
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_batches_quantity CHECK (quantity > 0 AND quantity <= 1000000),
    CONSTRAINT chk_stock_batches_status CHECK (status IN ('ACTIVE', 'SOLD_OUT', 'DISCARDED')),
    CONSTRAINT chk_stock_batches_discard_reason CHECK (discard_reason IS NULL OR discard_reason IN ('EXPIRED', 'WASTE')),
    CONSTRAINT chk_stock_batches_discarded CHECK ((status = 'DISCARDED') = (discarded_at IS NOT NULL))
);
-- "expiring soon" / "expired": the open batches by date
CREATE INDEX IF NOT EXISTS idx_stock_batches_active_expiry ON stock_batches (expires_on) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_stock_batches_product ON stock_batches (product_id, expires_on);
