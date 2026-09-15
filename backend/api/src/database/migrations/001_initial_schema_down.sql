-- ============================================================================
-- Migration 001 Rollback: Drop all tables, views, and enums in reverse order
-- ============================================================================

DROP VIEW IF EXISTS v_product_catalog;

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS riders CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS order_status_history CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS inventory_adjustments CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS customer_addresses CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS otp_verifications CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS service_areas CASCADE;
DROP TABLE IF EXISTS dark_stores CASCADE;
DROP TABLE IF EXISTS system_configurations CASCADE;

DROP TYPE IF EXISTS notification_status_enum;
DROP TYPE IF EXISTS notification_channel_enum;
DROP TYPE IF EXISTS delivery_assignment_status_enum;
DROP TYPE IF EXISTS payment_status_enum;
DROP TYPE IF EXISTS payment_method_enum;
DROP TYPE IF EXISTS item_fulfillment_status_enum;
DROP TYPE IF EXISTS order_status_enum;
DROP TYPE IF EXISTS inventory_adjustment_type_enum;
DROP TYPE IF EXISTS inventory_tracking_mode_enum;
DROP TYPE IF EXISTS user_role_enum;
