-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 029: rider applications and approval
-- ============================================================================
-- 2026-10-07 (owner). Riders apply in the Blynk Rider app (phone + SMS code,
-- name, vehicle); Operations or Admin approve or reject the request under
-- "Rider requests". Only an APPROVED rider can sign in (phone + SMS code
-- only), be listed, suggested, assigned or picked for a cash hand-in.
--
--   approval_status  PENDING | APPROVED | REJECTED. Every rider that exists
--                    before this migration (store-made and staff riders) is
--                    APPROVED - the column default.
--   applied_at       when the request was sent (NULL for riders made before
--                    applications existed, and for staff riders).
--   reviewed_at/by   who approved or rejected it, and when.
--   rejection_reason shown to the rider when signing in after a rejection.
--
-- A bicycle has no registration number: vehicle_registration_number becomes
-- NULLable (the API still requires it for every other vehicle type).

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_approval_status;
ALTER TABLE riders
  ADD CONSTRAINT chk_riders_approval_status CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));

-- The review queue: requests by status, oldest first.
CREATE INDEX IF NOT EXISTS idx_riders_approval_applied
  ON riders (approval_status, applied_at)
  WHERE applied_at IS NOT NULL;

-- Bicycles carry no registration number.
ALTER TABLE riders ALTER COLUMN vehicle_registration_number DROP NOT NULL;
