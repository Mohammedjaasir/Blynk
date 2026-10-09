-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 032: company and commission riders, and what each delivery earned
-- ============================================================================
-- 2026-10-09 (owner). Like Uber/PickMe, an approved rider is one of two kinds:
--  * COMPANY    - salaried; earns nothing per delivery, Blynk keeps the whole
--                 delivery charge.
--  * COMMISSION - earns a share of the delivery charge (e.g. 80%; Blynk keeps
--                 the other 20% and, always, the product margin).
--
-- * riders.pay_type TEXT NOT NULL DEFAULT 'COMPANY' - existing riders become
--   COMPANY so nothing they see or hand in changes until staff set them up.
--   (A newly approved rider gets whatever the approver picks.)
-- * riders.commission_percent NUMERIC(5,2) NULL, 0..100 - this rider's own
--   share; NULL means the store default (system_configurations
--   'rider_commission' {"default_percent": 80}; no row = 80).
-- * orders.standard_delivery_fee NUMERIC(10,2) NULL - the standard delivery
--   fee in effect when the order was placed. orders.delivery_fee is what the
--   customer paid, which is 0 for a free delivery; the owner decided a
--   commission rider still earns their share of the normal fee (Blynk pays
--   it). Filled at order creation from now on.
--   Backfill: delivery_fee, except an order with delivery_fee = 0 placed since
--   free deliveries began (2026-10-08 Asia/Colombo) is assumed to have been a
--   free delivery and gets today's configured fee (or 100). An approximation:
--   the fee in effect on that day was not recorded.
-- * deliveries.rider_pay_type, rider_commission_percent, rider_earning_lkr -
--   a snapshot taken when the delivery is settled (lifecycle settleCod), so a
--   later change to the rider or the default never rewrites history. NULL
--   until delivered. Backfill: every DELIVERED row becomes COMPANY / NULL / 0
--   - every rider was COMPANY until now - so past cash reconciliations are
--   unchanged.
--
-- No cost column: order_items.estimated_unit_cost already snapshots the
-- product's purchase cost at order creation (actual_unit_cost is set at pack).

ALTER TABLE riders ADD COLUMN IF NOT EXISTS pay_type TEXT NOT NULL DEFAULT 'COMPANY';
ALTER TABLE riders ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);

ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_pay_type;
ALTER TABLE riders ADD CONSTRAINT chk_riders_pay_type CHECK (pay_type IN ('COMPANY', 'COMMISSION'));
ALTER TABLE riders DROP CONSTRAINT IF EXISTS chk_riders_commission_percent;
ALTER TABLE riders ADD CONSTRAINT chk_riders_commission_percent
  CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS standard_delivery_fee NUMERIC(10,2);

UPDATE orders o
   SET standard_delivery_fee = CASE
         WHEN o.delivery_fee = 0 AND o.created_at >= TIMESTAMPTZ '2026-10-08 00:00:00+05:30'
           THEN COALESCE(
                  (SELECT CASE WHEN jsonb_typeof(c.value->'fee_lkr') = 'number' THEN (c.value->>'fee_lkr')::NUMERIC END
                     FROM system_configurations c WHERE c.key = 'delivery_fee'),
                  100)
         ELSE o.delivery_fee
       END
 WHERE o.standard_delivery_fee IS NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_standard_delivery_fee;
ALTER TABLE orders ADD CONSTRAINT chk_orders_standard_delivery_fee
  CHECK (standard_delivery_fee IS NULL OR standard_delivery_fee >= 0);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_pay_type TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_commission_percent NUMERIC(5,2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rider_earning_lkr NUMERIC(10,2);

ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_pay_type;
ALTER TABLE deliveries ADD CONSTRAINT chk_deliveries_rider_pay_type
  CHECK (rider_pay_type IS NULL OR rider_pay_type IN ('COMPANY', 'COMMISSION'));
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_rider_earning;
ALTER TABLE deliveries ADD CONSTRAINT chk_deliveries_rider_earning
  CHECK (rider_earning_lkr IS NULL OR rider_earning_lkr >= 0);

UPDATE deliveries
   SET rider_pay_type = 'COMPANY', rider_commission_percent = NULL, rider_earning_lkr = 0
 WHERE assignment_status = 'DELIVERED' AND rider_pay_type IS NULL;
