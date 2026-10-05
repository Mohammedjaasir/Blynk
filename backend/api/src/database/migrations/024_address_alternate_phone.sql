-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 024: an additional phone number on a delivery address
-- ============================================================================
-- 2026-10-05. A customer can give a second number on a saved address so the
-- rider has someone else to call when the recipient does not answer.
--
-- * customer_addresses.alternate_phone: optional, stored normalised to E.164
--   (+94XXXXXXXXX) by the same Sri Lankan normaliser as recipient_phone, and
--   never equal to recipient_phone (checked by the API).
-- * orders.delivery_alternate_phone: snapshot taken from the chosen address
--   at order creation, like the other delivery_* fields, so editing the
--   address later never changes an order already placed.
-- Both are nullable; existing rows simply have no additional number.

ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(20) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_alternate_phone VARCHAR(20) NULL;
