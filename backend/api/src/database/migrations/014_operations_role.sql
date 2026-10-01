-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 014: OPERATIONS staff role + disabling staff accounts
-- ============================================================================
-- Blynk Admin creates staff accounts (Admin -> Staff accounts, 2026-09-30):
--   * PACKING_STAFF ("Inventory")  - may use only the Inventory site;
--   * OPERATIONS    ("Operations") - may use only the Operations app;
--   * ADMIN                         - Admin site, and creates the accounts.
--
-- * 'OPERATIONS' is added to user_role_enum. The runner wraps each migration
--   in one transaction (migrate.ts); PostgreSQL allows ALTER TYPE ... ADD
--   VALUE there as long as the new value is not *used* before COMMIT, so this
--   file deliberately never mentions it anywhere else (no default, no index,
--   no UPDATE).
-- * staff_disabled_at: when set, the account can no longer sign in (email +
--   password or SMS code) or refresh a session. NULL = active. Separate from
--   is_active, which customers/riders use and which shows a different error.

ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'OPERATIONS';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS staff_disabled_at TIMESTAMPTZ NULL;
