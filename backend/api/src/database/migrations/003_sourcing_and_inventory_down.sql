-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Rollback Migration 003: Inventory & Sourcing Subsystem Extensions
-- ============================================================================

DROP INDEX IF EXISTS idx_suppliers_active;
DROP INDEX IF EXISTS idx_sourcing_records_supplier;
DROP INDEX IF EXISTS idx_sourcing_records_order;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_inv_qty_available'
    ) THEN
        ALTER TABLE inventory DROP CONSTRAINT chk_inv_qty_available;
    END IF;
END $$;

DROP TABLE IF EXISTS sourcing_records;
DROP TABLE IF EXISTS suppliers;
