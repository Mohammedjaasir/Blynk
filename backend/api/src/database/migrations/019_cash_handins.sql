-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 019: rider cash hand-ins
-- ============================================================================
-- Riders collect COD cash (deliveries.cod_collected_amount, set when a
-- delivery is settled - the rider's collect-cod or an admin marking it
-- delivered). At the end of a shift they hand it to the store; staff
-- (ADMIN / OPERATIONS) record each hand-in here.
--
-- Reconciliation per rider per business day (Asia/Colombo): cash collected
-- that day (sum of settled deliveries by delivered_at) against handed in
-- (sum of these rows by handin_date). Nothing is stored for the difference;
-- it is computed on read.

CREATE TABLE IF NOT EXISTS cash_handins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    handin_date DATE NOT NULL,
    note TEXT,
    recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_handins_date_rider ON cash_handins (handin_date, rider_id);

-- The reconciliation reads settled deliveries by day.
CREATE INDEX IF NOT EXISTS idx_deliveries_delivered_at ON deliveries (delivered_at) WHERE assignment_status = 'DELIVERED';
