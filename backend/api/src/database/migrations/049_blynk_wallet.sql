-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 049: Blynk Wallet
-- ============================================================================
-- Owner, 2026-10-15: every approved refund (cancelled / returned / missing /
-- damaged items, failed orders caused by Blynk, the delivery fee when the
-- whole order was wrong) is credited to the customer's Blynk Wallet,
-- whatever the payment method. The balance pays for future orders; it is
-- never paid out as cash or moved to another account.
--
-- 1. wallet_entries - an append-only ledger, signed (+ credit / - debit).
--    The balance is the sum per customer (wallet_balance(), v_wallet_balances)
--    and is never negative: every write takes the customer's users row lock
--    first (like points_ledger, migration 037).
-- 2. orders.wallet_amount_used - what the wallet paid for the order. It is a
--    payment, not a discount, so
--      total_amount = subtotal + delivery_fee - discount_amount - wallet_amount_used
--    and total_amount stays "what is still to pay" (the cash the rider
--    collects, or the amount sent to PayHere).
-- 3. The `wallet` setting (system_configurations) is written by the API on
--    first change; a missing row reads as {enabled: true, expiry_months: 0,
--    max_use_percent: 100}.

CREATE TABLE IF NOT EXISTS wallet_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    reason VARCHAR(200),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ,
    CONSTRAINT chk_wallet_kind CHECK (kind IN (
      'REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ADJUSTMENT',
      'ORDER_PAYMENT', 'ORDER_PAYMENT_RETURNED', 'EXPIRED'
    )),
    CONSTRAINT chk_wallet_nonzero CHECK (amount <> 0),
    CONSTRAINT chk_wallet_sign CHECK (
      (kind IN ('REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ORDER_PAYMENT_RETURNED') AND amount > 0)
      OR (kind IN ('ORDER_PAYMENT', 'EXPIRED') AND amount < 0)
      OR kind = 'ADJUSTMENT'
    ),
    -- Only credits can expire.
    CONSTRAINT chk_wallet_expiry CHECK (expires_at IS NULL OR amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_entries_customer ON wallet_entries (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_entries_order ON wallet_entries (order_id) WHERE order_id IS NOT NULL;
-- Credits with an expiry date (the expiry sweep).
CREATE INDEX IF NOT EXISTS idx_wallet_entries_expiring ON wallet_entries (expires_at) WHERE expires_at IS NOT NULL;
-- One wallet payment per order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_entries_order_payment ON wallet_entries (order_id) WHERE kind = 'ORDER_PAYMENT';

-- Append-only: entries are never changed (deleting a customer still removes theirs).
CREATE OR REPLACE FUNCTION wallet_entries_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id IS NULL AND OLD.order_id IS NOT NULL
     AND NEW.id = OLD.id AND NEW.amount = OLD.amount AND NEW.kind = OLD.kind THEN
    RETURN NEW; -- ON DELETE SET NULL from orders
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND NEW.id = OLD.id AND NEW.amount = OLD.amount AND NEW.kind = OLD.kind THEN
    RETURN NEW; -- ON DELETE SET NULL from users
  END IF;
  RAISE EXCEPTION 'wallet_entries is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_entries_append_only ON wallet_entries;
CREATE TRIGGER trg_wallet_entries_append_only
  BEFORE UPDATE ON wallet_entries
  FOR EACH ROW EXECUTE FUNCTION wallet_entries_append_only();

-- The ledger sum (expiry not yet written as EXPIRED rows is applied by the API).
CREATE OR REPLACE FUNCTION wallet_balance(p_customer UUID) RETURNS NUMERIC AS $$
  SELECT coalesce(sum(amount), 0)::numeric(12, 2) FROM wallet_entries WHERE customer_id = p_customer;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW v_wallet_balances AS
  SELECT customer_id, sum(amount)::numeric(12, 2) AS balance, max(created_at) AS last_entry_at
    FROM wallet_entries
   GROUP BY customer_id;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_amount_used NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_wallet_amount;
ALTER TABLE orders ADD CONSTRAINT chk_order_wallet_amount CHECK (wallet_amount_used >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount - wallet_amount_used);
