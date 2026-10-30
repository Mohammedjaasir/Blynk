-- ============================================================================
-- Migration 065: commission-free month for sellers
-- ============================================================================
-- Owner's brother, 2026-10-30: "1 month free for a seller, after that Admin decides the rate" and
-- a countdown in the seller app. A seller's sales delivered BEFORE sellers.commission_free_until
-- carry no commission (modules/sellers/seller.commission.ts); later sales use the normal rates
-- (the seller's own rate, else the category's, else the default). The date is set when the seller
-- is approved (approval time + the seller_commission setting's free_days, default 30) and Admin can
-- change it per seller. NULL = no free period.
--
-- Sellers who are already APPROVED get 30 days from their approval (or from sign-up when no
-- approval time was kept). The API is deployed before this runs (migrations are run by hand in
-- Coolify): it checks for the column and behaves as "no free period" until it exists.

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS commission_free_until TIMESTAMPTZ NULL;

UPDATE sellers
   SET commission_free_until = COALESCE(reviewed_at, created_at) + INTERVAL '30 days'
 WHERE status = 'APPROVED' AND commission_free_until IS NULL;
