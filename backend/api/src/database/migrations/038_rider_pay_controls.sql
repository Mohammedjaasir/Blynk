-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 038: rider pay controls - pay models, bonuses, adjustments
-- ============================================================================
-- Owner, 2026-10-10: "give the option in ops and admin to control the rider
-- app charges" - fixed pay per delivery, distance-based pay, bonuses &
-- incentives, deductions/penalties, all controlled in Ops and Admin.
--
-- Settings (no migration needed, system_configurations rows; a missing row
-- means the defaults in riders/rider.pay-rules.ts):
--   'rider_pay_model'   the store default model {model, fixed_lkr, base_lkr,
--                       per_km_lkr, min_lkr}; PERCENT's % stays in
--                       'rider_commission' (migration 032)
--   'rider_bonus_rules' {company_riders, peak, daily_target, long_distance}
--   'rider_rain_boost'  {on, mode, amount, auto_off_at, turned_on_at}
--
-- * riders.pay_model TEXT NULL (PERCENT | FIXED | DISTANCE) - this rider's
--   own model; NULL follows the store default. pay_fixed_lkr, pay_base_lkr,
--   pay_per_km_lkr, pay_min_lkr: this rider's own numbers, each NULL = the
--   store default's. COMPANY riders have all of them NULL.
--   Backfill: a rider with their own commission_percent was on their own
--   percentage deal, so they get pay_model 'PERCENT' - changing the store
--   default model later does not move them.
--
-- * deliveries: the settlement snapshot grows (all NULL until delivered;
--   rider_earning_lkr stays the total this delivery earned, so the cash keep
--   rule min(rider_earning_lkr, cod) still holds):
--     rider_pay_model          the model applied (NULL for COMPANY)
--     rider_pay_inputs         JSONB, the numbers applied (percent, fixed_lkr,
--                              base_lkr, per_km_lkr, min_lkr, standard_fee)
--     rider_distance_km        road km store -> drop-off (when needed)
--     rider_distance_estimated true = OSRM was unavailable; straight line x 1.3
--     rider_base_earning_lkr   the model's pay incl. the minimum floor
--     rider_bonus_lkr          peak + rain + long-distance bonuses
--   Backfill: every settled row gets base = rider_earning_lkr, bonus = 0 and,
--   for COMMISSION rows, model PERCENT - what migration 032 paid.
--
-- * rider_earning_lines - one row per bonus earned. A per-delivery bonus
--   (PEAK_BOOST, RAIN_BOOST, LONG_DISTANCE) carries its delivery_id and is
--   already inside that delivery's rider_earning_lkr; a DAILY_TARGET line is
--   per rider per Colombo day (delivery_id NULL) and is kept from that day's
--   cash. dedupe_key makes each line idempotent.
--
-- * rider_pay_adjustments - staff +/- entries (deduction or extra pay) with
--   a reason, note and the Colombo day whose cash they settle against.
--   Audited in audit_logs (RIDER_PAY_ADJUSTMENT_*).

ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_model TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_fixed_lkr NUMERIC(10,2);
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_base_lkr NUMERIC(10,2);
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_per_km_lkr NUMERIC(10,2);
ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_min_lkr NUMERIC(10,2);

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_model;
ALTER TABLE riders ADD CONSTRAINT chk_riders_pay_model
  CHECK (pay_model IS NULL OR pay_model IN ('PERCENT', 'FIXED', 'DISTANCE'));
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_amounts;
ALTER TABLE riders ADD CONSTRAINT chk_riders_pay_amounts CHECK (
  (pay_fixed_lkr IS NULL OR pay_fixed_lkr >= 0) AND
  (pay_base_lkr IS NULL OR pay_base_lkr >= 0) AND
  (pay_per_km_lkr IS NULL OR pay_per_km_lkr >= 0) AND
  (pay_min_lkr IS NULL OR pay_min_lkr >= 0)
);

UPDATE riders SET pay_model = 'PERCENT'
 WHERE pay_type = 'COMMISSION' AND commission_percent IS NOT NULL AND pay_model IS NULL;

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_pay_model TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_pay_inputs JSONB;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_distance_km NUMERIC(8,2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_distance_estimated BOOLEAN;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_base_earning_lkr NUMERIC(10,2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_bonus_lkr NUMERIC(10,2);

ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_model;
ALTER TABLE deliveries ADD CONSTRAINT chk_deliveries_rider_pay_model
  CHECK (rider_pay_model IS NULL OR rider_pay_model IN ('PERCENT', 'FIXED', 'DISTANCE'));
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_parts;
ALTER TABLE deliveries ADD CONSTRAINT chk_deliveries_rider_pay_parts CHECK (
  (rider_distance_km IS NULL OR rider_distance_km >= 0) AND
  (rider_base_earning_lkr IS NULL OR rider_base_earning_lkr >= 0) AND
  (rider_bonus_lkr IS NULL OR rider_bonus_lkr >= 0)
);

UPDATE deliveries
   SET rider_base_earning_lkr = COALESCE(rider_earning_lkr, 0),
       rider_bonus_lkr = 0,
       rider_pay_model = CASE WHEN rider_pay_type = 'COMMISSION' THEN 'PERCENT' END
 WHERE assignment_status = 'DELIVERED' AND rider_base_earning_lkr IS NULL;

CREATE TABLE IF NOT EXISTS rider_earning_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES deliveries(id) ON DELETE CASCADE,
  earning_date DATE NOT NULL,
  kind TEXT NOT NULL,
  amount_lkr NUMERIC(10,2) NOT NULL,
  detail JSONB,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_rider_earning_lines_dedupe UNIQUE (dedupe_key),
  CONSTRAINT chk_rider_earning_lines_kind CHECK (kind IN ('PEAK_BOOST', 'RAIN_BOOST', 'LONG_DISTANCE', 'DAILY_TARGET')),
  CONSTRAINT chk_rider_earning_lines_amount CHECK (amount_lkr > 0),
  CONSTRAINT chk_rider_earning_lines_scope CHECK ((kind = 'DAILY_TARGET') = (delivery_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_rider_earning_lines_rider_date ON rider_earning_lines (rider_id, earning_date);
CREATE INDEX IF NOT EXISTS idx_rider_earning_lines_delivery ON rider_earning_lines (delivery_id) WHERE delivery_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rider_pay_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  amount_lkr NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  adjustment_date DATE NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rider_pay_adjustments_amount CHECK (amount_lkr <> 0),
  CONSTRAINT chk_rider_pay_adjustments_reason CHECK (reason IN ('CASH_SHORT', 'DAMAGED_ITEM', 'LATE', 'BONUS', 'OTHER')),
  CONSTRAINT chk_rider_pay_adjustments_note CHECK (note IS NULL OR char_length(note) <= 300)
);
CREATE INDEX IF NOT EXISTS idx_rider_pay_adjustments_rider_date ON rider_pay_adjustments (rider_id, adjustment_date);
CREATE INDEX IF NOT EXISTS idx_rider_pay_adjustments_date ON rider_pay_adjustments (adjustment_date);
