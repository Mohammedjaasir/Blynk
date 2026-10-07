-- Migration 029 DOWN: drop rider applications.
-- Riders still waiting or rejected would become ordinary (active-looking)
-- riders without these columns, so they are switched off first.
UPDATE riders SET is_active = false, is_available = false WHERE approval_status <> 'APPROVED';
-- A bicycle with no registration number gets a visible stand-in before the
-- column is NOT NULL again.
UPDATE riders SET vehicle_registration_number = 'BICYCLE' WHERE vehicle_registration_number IS NULL;
ALTER TABLE riders ALTER COLUMN vehicle_registration_number SET NOT NULL;
DROP INDEX IF EXISTS idx_riders_approval_applied;
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_approval_status;
ALTER TABLE riders
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS approval_status;
