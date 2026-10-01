-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 016: proof of delivery with a customer code
-- ============================================================================
-- The owner chose "Customer OTP" (2026-09-30): when an order goes
-- OUT_FOR_DELIVERY it gets a 4-digit code that only its customer sees (the
-- customer order detail API). The rider (or the Operations operator acting
-- as rider) must enter it to complete the delivery; an admin marking the
-- order delivered enters it or writes an override note.
--
-- * A table of its own, not columns on orders: staff and rider queries read
--   orders with selectAll, so a column there would leak the code. Nothing
--   but the customer detail and the lifecycle reads this table.
-- * One row per order. A re-dispatch (after a re-stage) issues a new code and
--   clears the attempt counter.
-- * failed_attempts / locked_until: 5 wrong codes lock the order for 15
--   minutes (counted here so the limit holds across API instances).
-- * confirmed_via records how the handover was confirmed: CODE, or OVERRIDE
--   (admin, with override_note). The order history note says the same.

CREATE TABLE IF NOT EXISTS order_delivery_codes (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    code TEXT NOT NULL CHECK (code ~ '^[0-9]{4}$'),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    confirmed_via TEXT CHECK (confirmed_via IN ('CODE', 'OVERRIDE')),
    confirmed_at TIMESTAMPTZ,
    confirmed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    override_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders already on the road when this ships get a code too, so their
-- customer can show one and the rider can finish the delivery.
INSERT INTO order_delivery_codes (order_id, code)
SELECT id, lpad(floor(random() * 10000)::int::text, 4, '0')
  FROM orders
 WHERE order_status = 'OUT_FOR_DELIVERY'
ON CONFLICT (order_id) DO NOTHING;
