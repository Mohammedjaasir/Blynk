-- ============================================================================
-- Migration 053: where a seller's shop is (a map pin Admin approves)
-- ============================================================================
-- Owner, 2026-10-24: "the coordinates for map and delivery related things should
-- work by the seller shop" and "coordinates should work by seller place and
-- delivery charge should charge by from that coordinates and admin can approve
-- this". Each seller pins the shop on a map in the seller site; the pin waits for
-- Admin; once approved it is where riders collect the seller's goods and what the
-- delivery charge is measured from (modules/sellers/seller.location.ts).
--
--   sellers.latitude / longitude / location_note
--       the APPROVED point (the only one delivery uses)
--   sellers.pending_latitude / pending_longitude / pending_location_note
--       what the seller asked for, waiting for Admin (kept after a rejection so
--       both sides can see what was refused)
--   sellers.location_status   NONE | PENDING | APPROVED | REJECTED (the latest request)
--   sellers.location_reject_reason / location_reviewed_at / location_reviewed_by
--
-- Both points are both-or-neither. Sri Lanka bounds are enforced by the API; the
-- CHECKs only keep them real coordinates. The API is deployed before this runs
-- (migrations are run by hand in Coolify): it checks for these columns and shows
-- "no location" until they exist.

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS latitude               NUMERIC(9,6) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS longitude              NUMERIC(9,6) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location_note          VARCHAR(200) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS pending_latitude       NUMERIC(9,6) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS pending_longitude      NUMERIC(9,6) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS pending_location_note  VARCHAR(200) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location_status        VARCHAR(10) NOT NULL DEFAULT 'NONE';
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location_reject_reason VARCHAR(200) NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location_reviewed_at   TIMESTAMPTZ NULL;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS location_reviewed_by   UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS chk_sellers_location_status;
ALTER TABLE sellers ADD CONSTRAINT chk_sellers_location_status
    CHECK (location_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS chk_sellers_location_pair;
ALTER TABLE sellers ADD CONSTRAINT chk_sellers_location_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL)
       AND (pending_latitude IS NULL) = (pending_longitude IS NULL));

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS chk_sellers_location_range;
ALTER TABLE sellers ADD CONSTRAINT chk_sellers_location_range
    CHECK ((latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
       AND (pending_latitude IS NULL OR (pending_latitude BETWEEN -90 AND 90 AND pending_longitude BETWEEN -180 AND 180)));

-- a waiting request always has a point to review
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS chk_sellers_location_pending;
ALTER TABLE sellers ADD CONSTRAINT chk_sellers_location_pending
    CHECK (location_status <> 'PENDING' OR pending_latitude IS NOT NULL);

-- Admin's queue: sellers whose location waits for review
CREATE INDEX IF NOT EXISTS idx_sellers_location_pending ON sellers (updated_at) WHERE location_status = 'PENDING';
