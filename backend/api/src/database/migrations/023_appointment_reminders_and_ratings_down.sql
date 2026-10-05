-- Migration 023 DOWN: drop doctor ratings, the reminder/prompt markers and
-- the SMS-fallback setting. Queued reminder/prompt rows in the outbox are
-- left alone (they are ordinary notifications).
DELETE FROM system_configurations WHERE key = 'appointment_reminder_sms_fallback';
DROP TABLE IF EXISTS doctor_ratings;
DROP INDEX IF EXISTS idx_appointments_rating_prompt_due;
DROP INDEX IF EXISTS idx_appointments_reminder_due;
ALTER TABLE appointments DROP COLUMN IF EXISTS rating_prompted_at;
ALTER TABLE appointments DROP COLUMN IF EXISTS reminded_at;
