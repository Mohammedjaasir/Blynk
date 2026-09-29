-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 013: customer feedback
-- ============================================================================
-- Customers can send feedback from the app (Profile / Help -> Send feedback)
-- and the store reads it in Blynk Admin (2026-09-29, owner's request).
--
-- * rating is optional (1-5 stars); the message is required and stored
--   trimmed, at most 2000 characters.
-- * status is the admin's inbox state: NEW until someone marks it READ.
-- * (status, created_at DESC) serves the admin list, which is "newest first",
--   usually filtered to NEW.
-- * The per-customer limit (5 an hour) is counted from this table by the API,
--   so it holds across restarts and API instances.

CREATE TABLE IF NOT EXISTS customer_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    category TEXT NOT NULL CHECK (category IN ('APP', 'DELIVERY', 'PRODUCTS', 'OTHER')),
    message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'READ')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_status_created
    ON customer_feedback (status, created_at DESC);

-- The hourly limit counts one customer's recent rows.
CREATE INDEX IF NOT EXISTS idx_customer_feedback_user_created
    ON customer_feedback (user_id, created_at DESC);
