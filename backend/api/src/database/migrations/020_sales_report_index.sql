-- ============================================================================
-- Migration 020: the Admin sales dashboard reads orders by placed_at
-- ============================================================================
-- The daily sales report (GET /admin/reports/sales) filters every query by
-- a placed_at range; no existing index leads with placed_at.
CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders (placed_at);
