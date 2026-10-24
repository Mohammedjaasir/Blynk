DROP INDEX IF EXISTS idx_purchase_order_items_product;
DROP INDEX IF EXISTS uq_purchase_order_items_line;
DROP TABLE IF EXISTS purchase_order_items;
DROP INDEX IF EXISTS idx_purchase_orders_supplier;
DROP INDEX IF EXISTS idx_purchase_orders_status;
DROP TABLE IF EXISTS purchase_orders;
DROP SEQUENCE IF EXISTS purchase_order_number_seq;
