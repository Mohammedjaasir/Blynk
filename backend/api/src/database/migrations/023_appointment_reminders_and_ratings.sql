-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 023: appointment reminders and doctor ratings ("Channel doctors")
-- ============================================================================
-- * appointments.reminded_at: set once when the day-before reminder is
--   handled (sent by push, SMS, or deliberately skipped). The reminder job
--   claims rows with a guarded UPDATE ... WHERE reminded_at IS NULL, so two
--   workers can never both send one (modules/dental/appointment-reminders.ts).
-- * appointments.rating_prompted_at: the same guard for the one-off
--   "How was your visit?" push sent two hours after the slot ends.
-- * doctor_ratings: one rating per appointment (1-5 stars, optional comment),
--   allowed once a CONFIRMED appointment's slot has ended. Staff may hide an
--   abusive one (hidden_at); hidden ratings are left out of the doctor's
--   public average and count.
-- * system_configurations.appointment_reminder_sms_fallback: whether a
--   customer without the app (no device, or push not configured) gets the
--   reminder by SMS instead. {"enabled": true} by default; set it to false to
--   stop paying for reminder SMS.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rating_prompted_at TIMESTAMPTZ;

-- The reminder job's scan: confirmed, not yet reminded, by start time.
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
    ON appointments (start_at)
    WHERE status = 'CONFIRMED' AND reminded_at IS NULL;

-- The rating prompt's scan: confirmed, not yet prompted, by end time.
CREATE INDEX IF NOT EXISTS idx_appointments_rating_prompt_due
    ON appointments (end_at)
    WHERE status = 'CONFIRMED' AND rating_prompted_at IS NULL;

CREATE TABLE IF NOT EXISTS doctor_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    clinic_id UUID NOT NULL REFERENCES dental_clinics(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    stars SMALLINT NOT NULL,
    comment VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hidden_at TIMESTAMPTZ,
    hidden_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_doctor_ratings_stars CHECK (stars BETWEEN 1 AND 5)
);

-- The public average/count (visible ratings only) and the staff list.
CREATE INDEX IF NOT EXISTS idx_doctor_ratings_doctor_visible
    ON doctor_ratings (doctor_id) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_ratings_doctor_created
    ON doctor_ratings (doctor_id, created_at DESC);

INSERT INTO system_configurations (key, value, description)
VALUES (
  'appointment_reminder_sms_fallback',
  '{"enabled": true}'::jsonb,
  'Appointment reminders: send by SMS when the customer cannot get an app push. Set enabled to false to stop reminder SMS.'
)
ON CONFLICT (key) DO NOTHING;
