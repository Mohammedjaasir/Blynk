-- Migration 012 DOWN: staff sign in with SMS codes only again.
DROP INDEX IF EXISTS users_email_lower_key;
ALTER TABLE users
    DROP COLUMN IF EXISTS staff_password_hash,
    DROP COLUMN IF EXISTS login_failed_attempts,
    DROP COLUMN IF EXISTS login_locked_until;
