-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 041: users.phone_hash - a stable phone identity across deletion
-- ============================================================================
-- Security audit 2026-10: DELETE /me replaces users.phone with a random
-- "del:..." placeholder so the number can register again, and every
-- per-customer promotion limit (coupon per-customer / first-order rules, free
-- deliveries, the birthday gift, referral friend eligibility) counted only by
-- users.id - so deleting and re-registering the same number got every perk
-- back. phone_hash keeps a non-reversible link from the verified number to
-- every account that ever held it:
--
--   users.phone_hash = hex(HMAC-SHA256(normalised phone, env.OTP_SECRET))
--
-- The app sets it when an account is created or signs in, when staff change a
-- number, and - the part that matters - keeps it when deleteCustomerAccount
-- anonymises the phone. The promotion checks count usage across all users
-- sharing it (users/phone-identity.ts). Not UNIQUE: a deleted account and the
-- number's new account share it on purpose.
--
-- No backfill here: the HMAC key is a server secret that must never be
-- written into a migration file, so existing rows are filled by the app (on
-- sign-in, and the promotion checks always hash the live account's current
-- phone themselves). Accounts deleted BEFORE this migration cannot be linked:
-- their number is already gone.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64);

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_phone_hash;
ALTER TABLE users ADD CONSTRAINT chk_users_phone_hash
  CHECK (phone_hash IS NULL OR phone_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON users (phone_hash) WHERE phone_hash IS NOT NULL;
