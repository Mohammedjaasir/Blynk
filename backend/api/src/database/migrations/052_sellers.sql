-- ============================================================================
-- Migration 052: sellers, their product submissions and payouts
-- ============================================================================
-- Owner, 2026-10-24: "a separate RWD application for sellers: they upload their
-- products; before that they have to be approved by our admin, and their
-- products and pricing also; they sign in with phone number and OTP".
-- Model (docs/superpowers/specs/2026-10-23-seller-portal-design.md): consignment.
-- Blynk stays the shop: it holds the stock, packs, delivers and collects the
-- cash. The seller's price is the product's purchase_cost; Admin sets the
-- customer price when approving. A seller change (new product or edit) is a
-- submission that waits for Admin; the live product keeps its old values until
-- it is approved.
--
--   sellers             one per SELLER user: shop profile + approval status + commission
--   products.seller_id  who supplies the product (NULL = Blynk's own)
--   seller_submissions  NEW / EDIT proposals waiting for (or past) review
--   seller_payouts      money Blynk has paid the seller (manual ledger)

CREATE TABLE IF NOT EXISTS sellers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    shop_name          VARCHAR(80)  NOT NULL,
    contact_name       VARCHAR(80)  NULL,
    address            VARCHAR(255) NULL,
    note               VARCHAR(500) NULL,
    status             VARCHAR(12)  NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
    rejection_reason   VARCHAR(300) NULL,
    reviewed_by        UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at        TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sellers_status ON sellers (status, created_at DESC);

ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id UUID NULL REFERENCES sellers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_seller ON products (seller_id) WHERE seller_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS seller_submissions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id              UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    -- NULL for a NEW product until it is approved (then the product it became)
    product_id             UUID NULL REFERENCES products(id) ON DELETE SET NULL,
    kind                   VARCHAR(4)  NOT NULL CHECK (kind IN ('NEW', 'EDIT')),
    status                 VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    -- what the seller proposes: name, category_id, unit, pack_size, description, image_url, barcode
    payload                JSONB NOT NULL,
    -- the seller's own price = the product's purchase_cost once approved
    seller_price           NUMERIC(12,2) NOT NULL CHECK (seller_price > 0),
    -- what Admin set for customers when approving
    approved_selling_price NUMERIC(12,2) NULL,
    reject_reason          VARCHAR(300) NULL,
    reviewed_by            UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at            TIMESTAMPTZ NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_submissions_status ON seller_submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_submissions_seller ON seller_submissions (seller_id, created_at DESC);
-- one waiting edit per product: a new edit replaces the waiting one
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_submissions_pending_edit
    ON seller_submissions (product_id) WHERE status = 'PENDING' AND kind = 'EDIT';

CREATE TABLE IF NOT EXISTS seller_payouts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id  UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    note       VARCHAR(200) NULL,
    paid_on    DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller ON seller_payouts (seller_id, paid_on DESC);
