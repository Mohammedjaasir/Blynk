-- Migration 024 DOWN: drop the additional phone number from addresses and
-- the order snapshot.
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_alternate_phone;
ALTER TABLE customer_addresses DROP COLUMN IF EXISTS alternate_phone;
