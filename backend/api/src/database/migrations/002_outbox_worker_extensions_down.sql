-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 002: Notification Outbox Worker Extensions (Rollback)
-- ============================================================================

DROP INDEX IF EXISTS idx_notifications_claim;

ALTER TABLE notifications
    DROP CONSTRAINT IF EXISTS chk_notification_attempts,
    DROP CONSTRAINT IF EXISTS chk_notification_max_attempts,
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS max_attempts,
    DROP COLUMN IF EXISTS next_attempt_at,
    DROP COLUMN IF EXISTS locked_at,
    DROP COLUMN IF EXISTS locked_by,
    DROP COLUMN IF EXISTS failed_at,
    DROP COLUMN IF EXISTS updated_at;

-- Note: In PostgreSQL, ENUM values cannot be cleanly removed without recreating the type,
-- but removing the columns and index fully restores table schema and prevents PROCESSING writes.
