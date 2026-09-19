import type { ActiveDelivery, ItemsSummary, OrderStatus } from '../lib/orders';

/** Shapes returned by the Blynk API - mirrors of the backend DTOs. */

export type UserRole =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'PACKING_STAFF'
  | 'RIDER'
  | 'SUPPORT';

export interface AuthUser {
  id: string;
  phone: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
}

/**
 * Admin product row - includes the internal cost fields the customer never
 * sees. Stock tracking is deliberately absent: tracking_mode lives on the
 * inventory table, which belongs to the Inventory application.
 */
export interface AdminProduct {
  id: string;
  category_id: string;
  category_name?: string;
  name: string;
  slug: string;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  purchase_cost: number;
  custom_markup_percent: number | null;
  effective_markup_percent?: number;
  calculated_selling_price?: number;
  selling_price?: number;
  is_available: boolean;
  is_active: boolean;
  updated_at?: string;
}

/** What the customer catalog endpoint returns (no cost or markup). */
export interface CustomerProduct {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  selling_price: number;
  is_available: boolean;
}

export interface Promotion {
  id: string;
  title: string;
  subtitle: string | null;
  /** Foreground promotional/product visual. */
  image_url: string | null;
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE';
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Paginated<T> {
  products: T[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ------------------------------------------------------------- orders
/** A row of GET /admin/orders (the staff Orders board). */
export interface BoardOrder {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  total_amount: number;
  placed_at: string;
  updated_at: string;
  scheduled_for: string | null;
  delivery_recipient_name: string;
  delivery_address_line1: string;
  delivery_city: string;
  items_summary: ItemsSummary;
  active_delivery: ActiveDelivery | null;
}

export interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  item_status: 'PENDING' | 'SOURCED' | 'PACKED' | 'UNAVAILABLE' | 'SUBSTITUTED';
}

export interface OrderHistoryRow {
  id: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus;
  reason_or_notes: string | null;
  created_at: string;
}

/** GET /admin/orders/:id - only the fields the Orders panel shows. */
export interface OrderDetail {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_method: 'COD' | 'ONLINE';
  payment_status: string;
  total_amount: number;
  placed_at: string;
  scheduled_for: string | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_instructions: string | null;
  cancellation_reason: string | null;
  items: OrderItemRow[];
  history: OrderHistoryRow[];
  delivery: { id: string; assignment_status: string; rider_name?: string | null } | null;
}

/** GET /admin/riders */
export interface RiderOption {
  id: string;
  full_name: string | null;
  phone: string;
  vehicle_type: string;
  vehicle_registration_number: string;
  open_deliveries: number;
}
