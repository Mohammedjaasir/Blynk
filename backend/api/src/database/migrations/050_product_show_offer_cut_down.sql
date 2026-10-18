-- Migration 050 DOWN: no per-product offer-cut switch.
ALTER TABLE products DROP COLUMN IF EXISTS show_offer_cut;
