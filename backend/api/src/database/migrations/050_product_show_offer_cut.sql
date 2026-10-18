-- ============================================================================
-- Migration 050: per-product "show the offer price cut" switch
-- ============================================================================
-- Owner, 2026-10-18: "for all the products we need the offer cut animation now
-- and for future products and while adding the product the admin can choose the
-- option for offer price cut down to show".
--
-- products.show_offer_cut BOOLEAN NOT NULL DEFAULT TRUE: whether the customer app
-- shows the struck "was" price (offer or MRP) and the saving for this product.
-- Every existing and new product starts ON; Admin / Ops can switch it off per
-- product. Prices themselves never change - this is display only.
--
-- The catalog views are untouched: the customer reads join products for it.

ALTER TABLE products ADD COLUMN IF NOT EXISTS show_offer_cut BOOLEAN NOT NULL DEFAULT TRUE;
