-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 042: order for family / someone else, and "needs help at the door"
-- ============================================================================
-- Owner, 2026-10-12: a customer (say, a child in Colombo) orders for a parent
-- at home. At checkout they mark the order "For someone else" and give the
-- receiver's name and Sri Lankan mobile for THIS order only - the saved
-- address is not changed. The receiver is snapshotted in the existing
-- orders.delivery_recipient_name / delivery_recipient_phone columns (as the
-- address recipient always was); this migration only records that the order
-- was placed for someone else, so:
--   * order SMS (and, with "Send delivery code to receiver" on, the delivery
--     code) go to the receiver, and the BUYER also gets the status texts
--     (orders/lifecycle/notify.ts);
--   * the rider and Ops see that the person at the door is not the buyer.
--
-- orders.delivery_needs_help: "Elderly / needs help - please knock and wait,
-- carry items inside". Shown to the rider and Ops on the order. Any order may
-- set it, not only orders for someone else.
--
-- Both default false, so every existing order reads exactly as before.
-- The staff switches ("Allow ordering for someone else", "Send delivery code
-- to receiver") are system_configurations rows (no migration needed).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ordered_for_someone_else BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_needs_help BOOLEAN NOT NULL DEFAULT FALSE;
