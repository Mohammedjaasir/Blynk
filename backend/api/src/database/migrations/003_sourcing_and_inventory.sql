-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 003: Inventory & Sourcing Subsystem Extensions
-- ============================================================================

-- 1. Suppliers / Market Sources Domain Table
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) UNIQUE,
    contact_person VARCHAR(128),
    contact_phone VARCHAR(20),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Dedicated Sourcing Records Audit Ledger
CREATE TABLE IF NOT EXISTS sourcing_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    quantity_sourced INTEGER NOT NULL,
    estimated_unit_cost NUMERIC(10, 2) NOT NULL,
    actual_unit_cost NUMERIC(10, 2) NOT NULL,
    sourcing_status item_fulfillment_status_enum NOT NULL DEFAULT 'SOURCED',
    notes TEXT,
    sourced_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sourcing_qty CHECK (quantity_sourced > 0),
    CONSTRAINT chk_sourcing_actual_cost CHECK (actual_unit_cost >= 0.00)
);

-- 3. Invariant: Available stock cannot become negative (quantity_on_hand >= quantity_reserved)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_qty_available'
    ) THEN
        ALTER TABLE inventory ADD CONSTRAINT chk_inv_qty_available CHECK (quantity_on_hand >= quantity_reserved);
    END IF;
END $$;

-- 4. Operational Indexes for Sourcing Lookups
CREATE INDEX IF NOT EXISTS idx_sourcing_records_order ON sourcing_records (order_id, order_item_id);
CREATE INDEX IF NOT EXISTS idx_sourcing_records_supplier ON sourcing_records (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers (is_active) WHERE is_active = TRUE;
