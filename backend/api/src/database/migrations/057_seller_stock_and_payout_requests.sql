-- ============================================================================
-- Migration 057: seller stock notes and payout requests
-- ============================================================================
-- Owner, 2026-10-24: "sellers send stock updates and payout requests
-- themselves". Consignment model (052): Blynk holds the seller's stock, sells
-- it, collects the cash and pays the seller. Two things the seller now starts
-- from the seller site, and staff finish in Admin
-- (modules/sellers/seller-requests.service.ts):
--
--   seller_stock_notes      "I'm bringing 20 of X on Tuesday". Staff receive it
--                           with the quantity that actually arrived, which goes
--                           onto the product's TRACKED stock through the stock
--                           ledger (a PURCHASE_RESTOCK movement), or cancel it.
--                           SENT -> RECEIVED | CANCELLED.
--   seller_payout_requests  "please pay me LKR 5,000 (bank / cash)". At most one
--                           REQUESTED per seller, never more than what is due.
--                           Staff pay it (a seller_payouts row, linked here) or
--                           decline it with a reason; the seller may withdraw
--                           it while it waits.
--                           REQUESTED -> PAID | DECLINED | WITHDRAWN.
--
-- Also commission by category (owner, 2026-10-24: "for sellers universally we
-- must be able to set a percentage on sales category-wise, and for each seller
-- also a separate percentage"). Per sold line the percent Blynk keeps is
--   the seller's own override         sellers.commission_percent (NULL = none)
--   else the product's category's     categories.seller_commission_percent
--   else its main category's          (a sub-category falls back to its parent)
--   else the global default           system_configurations 'seller_commission'
-- (modules/sellers/seller.commission.ts). Existing sellers keep their value as
-- an override; new sellers start without one.
--
-- The API is deployed before this runs (migrations are run by hand in Coolify):
-- it checks for these tables and answers 503 SELLER_REQUESTS_NOT_READY until
-- they exist (commission falls back to the seller's own percent only). The
-- product of a stock note must be the seller's own: the API enforces it
-- (products.seller_id can change, so it is not a constraint here).

ALTER TABLE sellers ALTER COLUMN commission_percent DROP NOT NULL;
ALTER TABLE sellers ALTER COLUMN commission_percent SET DEFAULT NULL;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS seller_commission_percent NUMERIC(5,2) NULL;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS chk_categories_seller_commission;
ALTER TABLE categories ADD CONSTRAINT chk_categories_seller_commission
    CHECK (seller_commission_percent IS NULL OR (seller_commission_percent >= 0 AND seller_commission_percent <= 100));

CREATE TABLE IF NOT EXISTS seller_stock_notes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id         UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity          INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
    -- the day the seller says the goods arrive (Colombo); NULL = not said
    expected_on       DATE NULL,
    note              VARCHAR(300) NULL,
    status            VARCHAR(10) NOT NULL DEFAULT 'SENT'
                      CHECK (status IN ('SENT', 'RECEIVED', 'CANCELLED')),
    -- what staff counted in (may differ from what the seller announced)
    received_quantity INTEGER NULL CHECK (received_quantity IS NULL OR received_quantity BETWEEN 1 AND 10000),
    received_by       UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    received_at       TIMESTAMPTZ NULL,
    -- the seller (withdrawing) or staff (goods never came)
    cancelled_by      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at      TIMESTAMPTZ NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_seller_stock_notes_received
        CHECK (status <> 'RECEIVED' OR (received_quantity IS NOT NULL AND received_at IS NOT NULL))
);
-- staff's queue: what is still coming, the soonest first
CREATE INDEX IF NOT EXISTS idx_seller_stock_notes_open ON seller_stock_notes (expected_on, created_at) WHERE status = 'SENT';
CREATE INDEX IF NOT EXISTS idx_seller_stock_notes_seller ON seller_stock_notes (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_payout_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id      UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method         VARCHAR(4) NOT NULL CHECK (method IN ('BANK', 'CASH')),
    bank_details   VARCHAR(300) NULL,
    note           VARCHAR(300) NULL,
    status         VARCHAR(10) NOT NULL DEFAULT 'REQUESTED'
                   CHECK (status IN ('REQUESTED', 'PAID', 'DECLINED', 'WITHDRAWN')),
    decline_reason VARCHAR(300) NULL,
    -- the ledger entry the payment became (NULL again if staff delete that entry)
    payout_id      UUID NULL REFERENCES seller_payouts(id) ON DELETE SET NULL,
    handled_by     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    handled_at     TIMESTAMPTZ NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_seller_payout_requests_declined CHECK (status <> 'DECLINED' OR decline_reason IS NOT NULL)
);
-- one waiting request per seller
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_payout_requests_open ON seller_payout_requests (seller_id) WHERE status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS idx_seller_payout_requests_status ON seller_payout_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_seller_payout_requests_seller ON seller_payout_requests (seller_id, created_at DESC);
