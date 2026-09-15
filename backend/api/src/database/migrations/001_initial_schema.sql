-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 001: Initial Schema Baseline (Harmonized Post-Audit Version)
-- ============================================================================

-- Ensure Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMERATED TYPES (ENUMS)
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('CUSTOMER', 'RIDER', 'PACKING_STAFF', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE inventory_tracking_mode_enum AS ENUM ('UNTRACKED', 'TRACKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE inventory_adjustment_type_enum AS ENUM (
        'PURCHASE_RESTOCK',
        'ORDER_RESERVATION',
        'ORDER_FULFILLMENT',
        'ORDER_CANCELLATION_RESTORE',
        'DAMAGE_WRITE_OFF',
        'INVENTORY_AUDIT_ADJUSTMENT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_status_enum AS ENUM (
        'PLACED',
        'PACKED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
        'FAILED',
        'CUSTOMER_UNAVAILABLE',
        'ITEM_UNAVAILABLE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE item_fulfillment_status_enum AS ENUM (
        'PENDING',
        'SOURCED',
        'PACKED',
        'UNAVAILABLE',
        'SUBSTITUTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('COD', 'ONLINE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE delivery_assignment_status_enum AS ENUM (
        'ASSIGNED',
        'ACCEPTED',
        'PICKED_UP',
        'ARRIVED_AT_CUSTOMER',
        'DELIVERED',
        'FAILED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel_enum AS ENUM ('SMS', 'WHATSAPP', 'IN_APP', 'EMAIL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_status_enum AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 1. CONFIGURATION DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_configurations (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. GEOGRAPHIC & DARK STORE DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS dark_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    address_line TEXT NOT NULL,
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    radius_km NUMERIC(5, 2) NOT NULL DEFAULT 4.00,
    contact_phone VARCHAR(20) NOT NULL,
    operating_start_time TIME NOT NULL DEFAULT '08:00:00',
    operating_end_time TIME NOT NULL DEFAULT '21:00:00',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_dark_store_lat CHECK (latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_dark_store_lon CHECK (longitude BETWEEN -180.0 AND 180.0),
    CONSTRAINT chk_dark_store_radius CHECK (radius_km > 0.0)
);

CREATE TABLE IF NOT EXISTS service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE CASCADE,
    area_name VARCHAR(128) NOT NULL,
    center_latitude NUMERIC(9, 6) NOT NULL,
    center_longitude NUMERIC(9, 6) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 4000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_service_area_lat CHECK (center_latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_service_area_lon CHECK (center_longitude BETWEEN -180.0 AND 180.0),
    CONSTRAINT chk_service_area_radius CHECK (radius_meters > 0)
);

-- ============================================================================
-- 3. USER & AUTHENTICATION DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    full_name VARCHAR(128),
    role user_role_enum NOT NULL DEFAULT 'CUSTOMER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    phone_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'LOGIN',
    attempts_count SMALLINT NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_otp_attempts CHECK (attempts_count <= max_attempts + 1)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_info VARCHAR(255),
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(64) NOT NULL DEFAULT 'Home',
    recipient_name VARCHAR(128) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city VARCHAR(64) NOT NULL,
    postal_code VARCHAR(16),
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    delivery_instructions TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_addr_lat CHECK (latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_addr_lon CHECK (longitude BETWEEN -180.0 AND 180.0)
);

-- ============================================================================
-- 4. CATALOG DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    sku VARCHAR(64) NOT NULL UNIQUE,
    barcode VARCHAR(64),
    unit VARCHAR(32) NOT NULL,
    pack_size VARCHAR(64),
    image_url TEXT,
    purchase_cost NUMERIC(10, 2) NOT NULL,
    custom_markup_percent NUMERIC(5, 2),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_product_purchase_cost CHECK (purchase_cost >= 0.00),
    CONSTRAINT chk_product_custom_markup CHECK (custom_markup_percent IS NULL OR custom_markup_percent >= 0.00)
);

CREATE OR REPLACE VIEW v_product_catalog AS
SELECT 
    p.id,
    p.category_id,
    c.name AS category_name,
    p.name,
    p.slug,
    p.description,
    p.sku,
    p.barcode,
    p.unit,
    p.pack_size,
    p.image_url,
    p.purchase_cost,
    p.custom_markup_percent,
    COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) AS effective_markup_percent,
    ROUND(
        p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) / 100.0)),
        2
    ) AS calculated_selling_price,
    p.is_available,
    p.is_active
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup';

-- ============================================================================
-- 5. INVENTORY DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    tracking_mode inventory_tracking_mode_enum NOT NULL DEFAULT 'UNTRACKED',
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    quantity_reserved INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_store_product UNIQUE (dark_store_id, product_id),
    CONSTRAINT chk_inv_qty_on_hand CHECK (quantity_on_hand >= 0),
    CONSTRAINT chk_inv_qty_reserved CHECK (quantity_reserved >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
    adjustment_type inventory_adjustment_type_enum NOT NULL,
    quantity_delta INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reference_order_id UUID,
    notes TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 6. ORDER DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(32) NOT NULL UNIQUE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE RESTRICT,
    order_status order_status_enum NOT NULL DEFAULT 'PLACED',
    payment_method payment_method_enum NOT NULL DEFAULT 'COD',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    
    subtotal_amount NUMERIC(10, 2) NOT NULL,
    delivery_fee NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    
    scheduled_for TIMESTAMPTZ,
    
    delivery_recipient_name VARCHAR(128) NOT NULL,
    delivery_recipient_phone VARCHAR(20) NOT NULL,
    delivery_address_line1 TEXT NOT NULL,
    delivery_address_line2 TEXT,
    delivery_city VARCHAR(64) NOT NULL,
    delivery_postal_code VARCHAR(16),
    delivery_latitude NUMERIC(9, 6) NOT NULL,
    delivery_longitude NUMERIC(9, 6) NOT NULL,
    delivery_instructions TEXT,
    
    cancellation_reason TEXT,
    cancelled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    customer_notes TEXT,
    internal_notes TEXT,
    
    placed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    packed_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_order_subtotal CHECK (subtotal_amount >= 0.00),
    CONSTRAINT chk_order_delivery_fee CHECK (delivery_fee >= 0.00),
    CONSTRAINT chk_order_total_match CHECK (total_amount = subtotal_amount + delivery_fee)
);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    
    product_name_snapshot VARCHAR(255) NOT NULL,
    sku_snapshot VARCHAR(64) NOT NULL,
    unit_snapshot VARCHAR(32) NOT NULL,
    
    unit_selling_price NUMERIC(10, 2) NOT NULL,
    estimated_unit_cost NUMERIC(10, 2) NOT NULL,
    actual_unit_cost NUMERIC(10, 2),
    markup_percentage_applied NUMERIC(5, 2) NOT NULL,
    
    quantity INTEGER NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL,
    item_status item_fulfillment_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_order_item_qty CHECK (quantity > 0),
    CONSTRAINT chk_order_item_selling_price CHECK (unit_selling_price >= 0.00),
    CONSTRAINT chk_order_item_est_cost CHECK (estimated_unit_cost >= 0.00),
    CONSTRAINT chk_order_item_act_cost CHECK (actual_unit_cost IS NULL OR actual_unit_cost >= 0.00),
    CONSTRAINT chk_order_item_subtotal CHECK (subtotal = unit_selling_price * quantity)
);

CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_status order_status_enum,
    new_status order_status_enum NOT NULL,
    changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason_or_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. PAYMENT DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    payment_method payment_method_enum NOT NULL DEFAULT 'COD',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    amount NUMERIC(10, 2) NOT NULL,
    transaction_reference VARCHAR(128),
    gateway_response JSONB,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_amount CHECK (amount >= 0.00)
);

-- ============================================================================
-- 8. RIDERS & FULFILLMENT DISPATCH DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    dark_store_id UUID NOT NULL REFERENCES dark_stores(id) ON DELETE RESTRICT,
    vehicle_type VARCHAR(32) NOT NULL DEFAULT 'MOTORCYCLE',
    vehicle_registration_number VARCHAR(32) NOT NULL,
    emergency_contact_phone VARCHAR(20),
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
    assignment_status delivery_assignment_status_enum NOT NULL DEFAULT 'ASSIGNED',
    cod_collected_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    handover_notes TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_delivery_cod_amount CHECK (cod_collected_amount >= 0.00)
);

-- Partial Unique Index: Exactly one active rider assignment per order.
-- Allows replacement assignment if previous assignment failed or was rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_active_assignment ON deliveries (order_id)
WHERE assignment_status NOT IN ('FAILED', 'REJECTED');

-- ============================================================================
-- 9. NOTIFICATION LOGGING DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    channel notification_channel_enum NOT NULL,
    notification_type VARCHAR(64) NOT NULL,
    recipient VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status notification_status_enum NOT NULL DEFAULT 'QUEUED',
    provider_name VARCHAR(64),
    provider_message_id VARCHAR(128),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 10. ADMINISTRATIVE AUDIT TRAIL DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PERFORMANCE & OPERATIONAL INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_customer_placed ON orders (customer_id, placed_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_active_queue ON orders (dark_store_id, order_status, placed_at ASC)
WHERE order_status IN ('PLACED', 'PACKED', 'OUT_FOR_DELIVERY');

CREATE INDEX IF NOT EXISTS idx_orders_scheduled ON orders (dark_store_id, scheduled_for ASC)
WHERE scheduled_for IS NOT NULL AND order_status = 'PLACED';

CREATE INDEX IF NOT EXISTS idx_products_category_active ON products (category_id, is_active, is_available)
INCLUDE (name, sku, unit, purchase_cost, custom_markup_percent);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_store_product ON inventory (dark_store_id, product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory (dark_store_id, quantity_on_hand)
WHERE tracking_mode = 'TRACKED' AND quantity_on_hand <= low_stock_threshold;

CREATE INDEX IF NOT EXISTS idx_deliveries_rider_active ON deliveries (rider_id, assignment_status)
WHERE assignment_status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER');

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history (order_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_notifications_worker_queue ON notifications (status, created_at ASC)
WHERE status = 'QUEUED';

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user ON customer_addresses (user_id)
WHERE is_deleted = FALSE;
