/**
 * Shapes of the backend responses the Inventory app reads. Captured from the
 * running API (GET /admin/inventory, /admin/inventory/:id,
 * /admin/inventory/adjustments, /admin/orders/:id/sourcing, /admin/suppliers,
 * /auth/me) - fields the app never uses are left out on purpose.
 */

/** OPERATIONS: Operations-app-only staff (backend migration 014) - refused here. */
export type Role = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN' | 'OPERATIONS';

export interface AuthUser {
  id: string;
  /** null: Inventory and Admin accounts have no phone (backend migration 028). */
  phone: string | null;
  full_name: string | null;
  email?: string | null;
  role: Role;
}

export type TrackingMode = 'TRACKED' | 'UNTRACKED';

/** One row of GET /admin/inventory: every catalog product, row or not. */
export interface StockRow {
  inventory_id: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  category_name: string;
  /** Owned by Admin; read-only here. */
  is_active: boolean;
  /** Owned by Admin; read-only here. */
  is_available: boolean;
  tracking_mode: TrackingMode;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  updated_at: string | null;
}

/** A row of GET /admin/inventory/low-stock (active, TRACKED products only). */
export interface LowStockItem {
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  category_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  /** OUT = nothing available; LOW = the rest. Server sorts OUT first. */
  stock_state: 'OUT' | 'LOW';
}

export interface LowStockReport {
  items: LowStockItem[];
  counts: { low: number; out: number; total: number };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export type AdjustmentType =
  | 'PURCHASE_RESTOCK'
  | 'DAMAGE_WRITE_OFF'
  | 'INVENTORY_AUDIT_ADJUSTMENT'
  | 'ORDER_RESERVATION'
  | 'ORDER_FULFILLMENT'
  | 'ORDER_CANCELLATION_RESTORE';

/** Types an operator may record by hand (backend D3 rule). */
export type ManualAdjustmentType = 'PURCHASE_RESTOCK' | 'DAMAGE_WRITE_OFF' | 'INVENTORY_AUDIT_ADJUSTMENT';

/** GET /admin/inventory/:productId (purchase_cost is returned but never shown). */
export interface StockDetail {
  inventory_id?: string | null;
  product_id: string;
  product_name: string;
  product_sku?: string;
  tracking_mode: TrackingMode;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  updated_at?: string | null;
  adjustments: DetailAdjustment[];
}

export interface DetailAdjustment {
  id: string;
  adjustment_type: AdjustmentType;
  quantity_delta: number;
  previous_quantity: number;
  new_quantity: number;
  reference_order_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  /** Who moved the stock; a CUSTOMER when their cancellation returned it. */
  actor_name?: string | null;
  actor_role?: Role | null;
}

/** A row of GET /admin/inventory/adjustments. */
export interface LedgerEntry extends DetailAdjustment {
  inventory_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  actor_name: string | null;
}

export type OrderStatus =
  | 'PLACED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE';

/**
 * The only order fields Inventory keeps. GET /admin/orders also returns the
 * customer's name, phone and address; sourcing doesn't need them, so the
 * resource layer drops them before they reach any screen.
 */
export interface QueueOrder {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  placed_at: string;
}

export type ItemStatus = 'PENDING' | 'SOURCED' | 'PACKED' | 'UNAVAILABLE' | 'SUBSTITUTED';

export interface SourcingRecord {
  id: string;
  quantity_sourced: number;
  estimated_unit_cost: number;
  actual_unit_cost: number;
  supplier_id: string | null;
  supplier: { id: string; name: string } | null;
  notes: string | null;
  created_at: string;
}

export interface SourcingItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  unit_snapshot: string;
  quantity: number;
  subtotal: number;
  /** Catalog cost snapshot at order time - the estimate. */
  estimated_unit_cost: number;
  /** Null until sourced. */
  actual_unit_cost: number | null;
  item_status: ItemStatus;
  sourcing_records: SourcingRecord[];
}

export interface OrderSourcing {
  order_id: string;
  order_number: string;
  order_status: OrderStatus;
  metrics: {
    total_items: number;
    sourced_items: number;
    unavailable_items: number;
    pending_items: number;
    is_sourcing_complete: boolean;
  };
  items: SourcingItem[];
}

export interface Supplier {
  id: string;
  name: string;
  code: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface SupplierInput {
  name?: string;
  code?: string;
  contact_person?: string;
  contact_phone?: string;
  address?: string;
  notes?: string;
  is_active?: boolean;
}

/**
 * Supplier deliveries: purchase orders as packing staff see them (GET /admin/purchase-orders and
 * /:id). The API sends packing staff no costs, totals, supplier phone or share text, and this app
 * never reads or sends any.
 */
export type DeliveryStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export interface DeliverySummary {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: DeliveryStatus;
  notes: string | null;
  expected_on: string | null;
  line_count: number;
  units_ordered: number;
  units_received: number;
}

export interface DeliveryLine {
  id: string;
  product_id: string;
  name: string;
  unit: string | null;
  ordered_qty: number;
  received_qty: number;
  remaining_qty: number;
  note: string | null;
  /** False: the product is not counted, so receiving it adds no stock. */
  stock_counted: boolean;
}

export interface Delivery {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: DeliveryStatus;
  notes: string | null;
  expected_on: string | null;
  received_at: string | null;
  lines: DeliveryLine[];
}

export interface DeliveryReceipt {
  purchase_order: Delivery;
  received: Array<{ item_id: string; name: string; received_qty: number; stock_added: boolean }>;
  /** Received lines that added no stock (the product is not counted). */
  skipped: Array<{ item_id: string; name: string }>;
}
