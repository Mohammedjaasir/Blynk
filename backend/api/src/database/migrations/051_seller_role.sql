-- ============================================================================
-- Migration 051: SELLER role (seller portal; owner, 2026-10-24)
-- ============================================================================
-- Sellers (local shops and home businesses) sign in to their own web app with
-- a phone number and an SMS code and list products that Admin approves. This
-- migration only adds the role value: the runner wraps each migration in one
-- transaction and PostgreSQL allows ALTER TYPE ... ADD VALUE there only while
-- the new value is not *used* before COMMIT (see migration 014), so the tables
-- that go with it are in 052.
-- Design: docs/superpowers/specs/2026-10-23-seller-portal-design.md

ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'SELLER';
