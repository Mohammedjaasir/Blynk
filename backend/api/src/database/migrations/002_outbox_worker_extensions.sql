-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 002: Notification Outbox Worker Extensions
-- ============================================================================

-- 1. Extend notification_status_enum with 'PROCESSING' if not present
DO $$ 
BEGIN
    ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add Worker Tracking Columns to notifications table
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128),
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Check constraints on attempts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_attempts'
    ) THEN
        ALTER TABLE notifications ADD CONSTRAINT chk_notification_attempts CHECK (attempts >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_max_attempts'
    ) THEN
        ALTER TABLE notifications ADD CONSTRAINT chk_notification_max_attempts CHECK (max_attempts > 0);
    END IF;
END $$;

-- 4. High-Performance Operational Claim Index for Worker Poller
-- Covers both QUEUED jobs ready for dispatch and stale PROCESSING jobs eligible for lease recovery
CREATE INDEX IF NOT EXISTS idx_notifications_claim
    ON notifications (status, next_attempt_at ASC)
    WHERE status IN ('QUEUED', 'PROCESSING');
