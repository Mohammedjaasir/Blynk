-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 012: staff email + password sign-in
-- ============================================================================
-- Staff (ADMIN, PACKING_STAFF) sign in to Blynk Admin, Inventory and Ops with
-- their email address and a password (2026-09-29, owner's request; replaces
-- the undeployed numeric passcode of 2026-09-28). Customers and riders keep
-- SMS codes, and staff can still fall back to an SMS code.
--
-- * The password is stored only as a bcrypt hash (pgcrypto). Set or change
--   one with:
--     UPDATE users SET email = 'you@example.com',
--            staff_password_hash = crypt('<password>', gen_salt('bf', 10))
--      WHERE phone = '+947XXXXXXXX';
--   and remove it (back to SMS only) with staff_password_hash = NULL.
-- * Five wrong passwords lock that account's password sign-in for 15 minutes
--   (login_failed_attempts / login_locked_until).
-- * Sign-in matches lower(email), so emails must be unique ignoring case.
--   users.email (migration 001) is only case-sensitively UNIQUE; the index
--   below closes that gap. If two accounts already share an email in
--   different case this migration stops with a message instead of touching
--   either row - fix the data by hand and redeploy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS staff_password_hash TEXT,
    ADD COLUMN IF NOT EXISTS login_failed_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ;

DO $$
DECLARE
    dupes TEXT;
BEGIN
    SELECT string_agg(e, ', ') INTO dupes
      FROM (SELECT lower(email) AS e FROM users
             WHERE email IS NOT NULL
             GROUP BY lower(email) HAVING count(*) > 1) d;
    IF dupes IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 012: these emails belong to more than one user (ignoring case): %. Make them unique, then re-run.', dupes;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email)) WHERE email IS NOT NULL;
