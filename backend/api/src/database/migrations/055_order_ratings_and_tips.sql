-- ============================================================================
-- Migration 055: order ratings and rider tips
-- ============================================================================
-- Owner, 2026-10-24: "Rate the order and tip the rider - one tap after
-- delivery" (docs/superpowers/plans/2026-10-24-groups-ratings-requests.md B).
--
--   order_ratings              one rating per DELIVERED order, by its customer,
--                              within 14 days of delivery; editable for 24 h
--                              (the rules live in modules/ratings). rider_id is
--                              the rider who delivered it, kept for the
--                              per-rider average.
--   orders.rider_tip           a tip added at checkout (0-1000 LKR). Collected
--                              in CASH with the order: part of total_amount
--                              (what the rider collects), never part of the
--                              items or the delivery fee, so
--                                total_amount = subtotal + delivery_fee
--                                  - discount_amount - wallet_amount_used + rider_tip
--   orders.rider_tip_wallet    a tip paid after delivery from the customer's
--   orders.rider_tip_wallet_at Blynk Wallet (a RIDER_TIP wallet debit, at most
--                              one per order). Not part of total_amount.
--
-- Both kinds go 100% to the rider who delivered the order: the rider pay ledger
-- (modules/riders/rider.pay-ledger.ts) shows them as "tips", apart from the
-- delivery pay. A cash tip stays in the rider's hand; a wallet tip is owed to
-- the rider and lowers that day's cash to hand in.
--
-- The API is deployed before this runs (migrations are run by hand in
-- Coolify): it checks for these columns and answers 503 RATINGS_NOT_READY
-- (and ignores a checkout tip) until they exist.

CREATE TABLE IF NOT EXISTS order_ratings (
    order_id    UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rider_id    UUID NULL REFERENCES riders(id) ON DELETE SET NULL,
    stars       SMALLINT NOT NULL,
    tags        TEXT[] NOT NULL DEFAULT '{}',
    comment     VARCHAR(500) NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_order_ratings_stars CHECK (stars BETWEEN 1 AND 5),
    CONSTRAINT chk_order_ratings_tags CHECK (
      tags <@ ARRAY['ON_TIME', 'LATE', 'FRIENDLY_RIDER', 'RUDE_RIDER', 'FRESH', 'DAMAGED',
                    'MISSING_ITEM', 'WRONG_ITEM', 'GOOD_PACKING']::TEXT[]
    )
);

-- Staff list (newest first), the low-rating filter and the per-rider average.
CREATE INDEX IF NOT EXISTS idx_order_ratings_created ON order_ratings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_ratings_low ON order_ratings (created_at DESC) WHERE stars <= 2;
CREATE INDEX IF NOT EXISTS idx_order_ratings_rider ON order_ratings (rider_id, created_at DESC) WHERE rider_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_tip           NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_tip_wallet    NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_tip_wallet_at TIMESTAMPTZ NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_rider_tip;
ALTER TABLE orders ADD CONSTRAINT chk_order_rider_tip
  CHECK (rider_tip >= 0 AND rider_tip <= 1000 AND rider_tip_wallet >= 0 AND rider_tip_wallet <= 1000);

-- The checkout tip is collected with the order.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount - wallet_amount_used + rider_tip);

-- Wallet tips: a new debit kind, one per order.
ALTER TABLE wallet_entries DROP CONSTRAINT IF EXISTS chk_wallet_kind;
ALTER TABLE wallet_entries ADD CONSTRAINT chk_wallet_kind CHECK (kind IN (
  'REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ADJUSTMENT',
  'ORDER_PAYMENT', 'ORDER_PAYMENT_RETURNED', 'EXPIRED', 'RIDER_TIP'
));
ALTER TABLE wallet_entries DROP CONSTRAINT IF EXISTS chk_wallet_sign;
ALTER TABLE wallet_entries ADD CONSTRAINT chk_wallet_sign CHECK (
  (kind IN ('REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ORDER_PAYMENT_RETURNED') AND amount > 0)
  OR (kind IN ('ORDER_PAYMENT', 'EXPIRED', 'RIDER_TIP') AND amount < 0)
  OR kind = 'ADJUSTMENT'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_entries_order_tip ON wallet_entries (order_id) WHERE kind = 'RIDER_TIP';
