-- ============================================================================
-- Migration 056: product requests ("Can't find it? Ask us")
-- ============================================================================
-- Owner, 2026-10-24: "Can't find it? Ask us - customers request products we
-- don't stock, Admin sees the most-requested list". A customer (or a guest)
-- names a product we don't have; Admin / Ops see the requests grouped by name,
-- most requested first, and mark the whole group PLANNED, ADDED (with the
-- product, which tells the requesters it is available) or DECLINED
-- (modules/catalog/product-requests.ts).
--
--   product_requests.user_id      the customer; NULL for a guest (no phone kept)
--   product_requests.name         what they typed, 2-80 characters
--   product_requests.name_key     the group: lowercase, trimmed, spaces collapsed
--   product_requests.note         up to 300 characters
--   product_requests.category_id  the aisle they were in, if any
--   product_requests.photo_url    reserved for the customer's own upload (not taken yet)
--   product_requests.status       NEW | PLANNED | ADDED | DECLINED
--   product_requests.product_id   the product it became (ADDED)
--   product_requests.staff_note   Admin / Ops' note, up to 300 characters
--
-- The API is deployed before this runs (migrations are run by hand in Coolify):
-- until the table exists every product-request route answers 503
-- PRODUCT_REQUESTS_NOT_READY and GET /store says product_requests_enabled: false.

CREATE TABLE IF NOT EXISTS product_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    name         VARCHAR(80)  NOT NULL,
    name_key     VARCHAR(80)  GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
    note         VARCHAR(300) NULL,
    category_id  UUID NULL REFERENCES categories(id) ON DELETE SET NULL,
    photo_url    VARCHAR(500) NULL,
    status       VARCHAR(10)  NOT NULL DEFAULT 'NEW',
    product_id   UUID NULL REFERENCES products(id) ON DELETE SET NULL,
    staff_note   VARCHAR(300) NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_product_requests_status CHECK (status IN ('NEW', 'PLANNED', 'ADDED', 'DECLINED')),
    CONSTRAINT chk_product_requests_name CHECK (char_length(btrim(name)) BETWEEN 2 AND 80)
);

-- the grouped staff list, and one group's rows for a status change
CREATE INDEX IF NOT EXISTS idx_product_requests_key ON product_requests (name_key, created_at DESC);
-- "my requests" and the 5-a-day limit
CREATE INDEX IF NOT EXISTS idx_product_requests_user ON product_requests (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests (status, created_at DESC);
