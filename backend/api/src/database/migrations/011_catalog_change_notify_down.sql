-- Migration 011 DOWN: stop notifying. Customer apps fall back to their
-- periodic catalog refresh.
DROP TRIGGER IF EXISTS trg_products_catalog_changed ON products;
DROP TRIGGER IF EXISTS trg_categories_catalog_changed ON categories;
DROP TRIGGER IF EXISTS trg_promotions_catalog_changed ON promotions;
DROP FUNCTION IF EXISTS notify_catalog_changed();
