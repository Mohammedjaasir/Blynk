-- ============================================================================
-- Migration 004 DOWN: Home Promotions
-- ============================================================================

DROP INDEX IF EXISTS idx_promotions_active_order;
DROP TABLE IF EXISTS promotions;
