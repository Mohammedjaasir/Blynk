-- Migration 041 DOWN: no stable phone identity (security audit 2026-10). The
-- link from deleted accounts to their number is lost; per-customer promotion
-- limits go back to counting by users.id only.
DROP INDEX IF EXISTS idx_users_phone_hash;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_phone_hash;
ALTER TABLE users DROP COLUMN IF EXISTS phone_hash;
