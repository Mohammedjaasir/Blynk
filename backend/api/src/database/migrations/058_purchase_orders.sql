-- ============================================================================
-- Migration 058: purchase orders (reorder suggestions -> supplier orders -> receiving)
-- ============================================================================
-- Owner, 2026-10-25: "reorder suggestions + supplier purchase orders". The Purchase list
-- (modules/inventory/purchase-list.ts) only copies a list; this adds the orders themselves
-- (modules/purchasing):
--
--   purchase_orders        one order to one supplier: BP-0001, BP-0002, ... (a sequence).
--                          DRAFT -> SENT -> PARTIAL -> RECEIVED, or CANCELLED (with a reason).
--                          supplier_id may be NULL (a draft not yet given a supplier); the supplier
--                          name is not copied: deleting a supplier leaves the order without one.
--   purchase_order_items   product (and variant) lines: what was ordered, what has arrived so far
--                          (received_qty grows with every receive, and may exceed ordered_qty) and
--                          the unit cost (the expected cost, overwritten by the real one at receive).
--                          A name snapshot keeps the order readable if the product is renamed.
--
-- Receiving adds stock through the existing stock writer (a PURCHASE_RESTOCK ledger row per line),
-- so nothing here touches inventory directly.
--
-- The API is deployed before this runs (migrations are run by hand in Coolify): until these tables
-- exist every /admin/purchase-orders and /admin/reorder-suggestions route answers
-- 503 PURCHASING_NOT_READY (never a 500).

CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number     VARCHAR(16) NOT NULL UNIQUE
                  DEFAULT ('BP-' || lpad(nextval('purchase_order_number_seq')::text, 4, '0')),
    supplier_id   UUID NULL REFERENCES suppliers(id) ON DELETE SET NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
    notes         VARCHAR(500) NULL,
    -- the day the supplier should deliver (Colombo); NULL = not said
    expected_on   DATE NULL,
    created_by    UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    sent_at       TIMESTAMPTZ NULL,
    sent_by       UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    -- set when the order is closed as RECEIVED (all of it, or closed short)
    received_at   TIMESTAMPTZ NULL,
    cancelled_at  TIMESTAMPTZ NULL,
    cancelled_by  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    cancel_reason VARCHAR(300) NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_purchase_orders_cancelled CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders (supplier_id, created_at DESC) WHERE supplier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id        UUID NULL REFERENCES product_variants(id) ON DELETE SET NULL,
    name_snapshot     VARCHAR(220) NOT NULL,
    unit_snapshot     VARCHAR(64) NULL,
    ordered_qty       INTEGER NOT NULL CHECK (ordered_qty BETWEEN 1 AND 100000),
    received_qty      INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    note              VARCHAR(300) NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one line per product (or variant) on an order
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_line
    ON purchase_order_items (purchase_order_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- "on order" per product (suggestions)
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items (product_id);
