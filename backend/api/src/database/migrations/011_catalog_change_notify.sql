-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 011: catalog change notifications
-- ============================================================================
-- Any write to what a customer sees in the shop - products (price, name,
-- photo, availability), categories, promotions - sends a Postgres NOTIFY on
-- the `catalog_changed` channel. The API LISTENs and pushes one event to
-- every connected customer app, which then re-reads the catalog at once.
--
-- Triggers rather than calls in each service: Blynk Ops, Admin, Inventory
-- and any future tool (or a manual SQL fix) all write these tables, and a
-- trigger cannot be forgotten by one of them. FOR EACH STATEMENT, so a bulk
-- update sends one notification, not one per row. The payload is only the
-- table name - no data leaves the database this way.

CREATE OR REPLACE FUNCTION notify_catalog_changed() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('catalog_changed', TG_TABLE_NAME);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_catalog_changed ON products;
CREATE TRIGGER trg_products_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON products
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

DROP TRIGGER IF EXISTS trg_categories_catalog_changed ON categories;
CREATE TRIGGER trg_categories_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON categories
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();

DROP TRIGGER IF EXISTS trg_promotions_catalog_changed ON promotions;
CREATE TRIGGER trg_promotions_catalog_changed
    AFTER INSERT OR UPDATE OR DELETE ON promotions
    FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_changed();
