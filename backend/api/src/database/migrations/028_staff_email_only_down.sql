-- Migration 028 DOWN: intentionally a no-op.
-- Migration 028 replaced every ADMIN and PACKING_STAFF phone number with a
-- 'nophone:...' placeholder and did not keep the old numbers, so they cannot
-- be restored. The placeholders are valid users.phone values, so nothing in
-- the schema needs undoing; give an account a number again from the Staff
-- accounts page (by moving it to Operations) if it needs one.
SELECT 1;
