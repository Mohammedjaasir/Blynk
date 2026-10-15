-- Migration 049 DOWN: Blynk Wallet removed.
-- Orders that used the wallet keep their totals (total_amount is what was
-- still to pay), so the old total rule is put back NOT VALID: it holds for
-- every new order and is not re-checked on the rows the wallet paid part of.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_total_match;
ALTER TABLE orders ADD CONSTRAINT chk_order_total_match
  CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount) NOT VALID;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_wallet_amount;
ALTER TABLE orders DROP COLUMN IF EXISTS wallet_amount_used;

DROP VIEW IF EXISTS v_wallet_balances;
DROP FUNCTION IF EXISTS wallet_balance(UUID);
DROP TABLE IF EXISTS wallet_entries;
DROP FUNCTION IF EXISTS wallet_entries_append_only();

DELETE FROM system_configurations WHERE key = 'wallet';
