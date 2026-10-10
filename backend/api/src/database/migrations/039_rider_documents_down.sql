-- Migration 039 DOWN: drop rider documents (owner, 2026-10-10).
-- The stored files under RIDER_DOCUMENTS_ROOT are not touched by SQL; remove
-- that directory by hand if the feature is rolled back for good.
DELETE FROM system_configurations WHERE key = 'rider_documents';
DROP INDEX IF EXISTS idx_rider_documents_draft_updated;
DROP INDEX IF EXISTS idx_rider_documents_expiry;
DROP INDEX IF EXISTS uq_rider_documents_draft_type;
DROP INDEX IF EXISTS uq_rider_documents_rider_type;
DROP TABLE IF EXISTS rider_documents;
