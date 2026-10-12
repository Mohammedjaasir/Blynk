-- Migration 042 DOWN: no "for someone else" / "needs help" flags on orders.
-- The receiver's name and phone stay in delivery_recipient_name / _phone (as
-- before 042); order SMS then go only to that number again.
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_needs_help;
ALTER TABLE orders DROP COLUMN IF EXISTS ordered_for_someone_else;
