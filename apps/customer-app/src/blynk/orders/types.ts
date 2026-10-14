/*
 * The customer order contract (backend/api/src/modules/orders): GET /orders/checkout-info,
 * POST /orders, GET /orders, GET /orders/:id, POST /orders/:id/cancel. Payment is cash on
 * delivery only (the server writes payment_method 'COD'); there is no payment field to send.
 */

export type OrderStatus =
  | 'PLACED' | 'PACKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE' | 'ITEM_UNAVAILABLE';

export interface FreeDeliveryStatus {
  enabled: boolean; count: number; since: string; used: number; remaining: number; applies: boolean;
}

export interface BasketFreeDeliveryStatus {
  enabled: boolean;
  min_subtotal_lkr: number;
  /** null = no subtotal was sent (or the offer is off and no answer applies). */
  applies: boolean | null;
  /** LKR still to add (0 once reached; null = off or no subtotal). */
  remaining_lkr: number | null;
}

/** GET /orders/checkout-info data. Advisory: placement decides again under locks. */
export interface CheckoutInfo {
  /** What this order would be charged (0 when a free delivery applies). */
  delivery_fee_lkr: number;
  standard_delivery_fee_lkr: number;
  delivery_fee_mode: 'FLAT' | 'DISTANCE_TIERS';
  delivery_distance_km: number | null;
  delivery_distance_estimated: boolean | null;
  delivery_fee_address_id: string | null;
  coupons_enabled: boolean;
  free_delivery: FreeDeliveryStatus;
  basket_free_delivery?: BasketFreeDeliveryStatus;
  /** Owner, 2026-10-12: whether checkout offers "For someone else" (absent on an older server = off). */
  order_for_someone_else?: { enabled: boolean; send_code_to_receiver: boolean };
  birthday_offer?: { eligible?: boolean; percent?: number; [k: string]: unknown };
  referral_reward?: { available: boolean; side: string | null; mode: string | null; amount_lkr: number };
  points?: {
    enabled: boolean; balance: number; value_lkr: number; earn_points?: number; earn_per_lkr?: number;
    lkr_per_point?: number; min_redeem_points?: number; max_redeem_percent?: number; [k: string]: unknown;
  };
}

/** POST /orders/validate-coupon data.coupon. */
export interface CouponPreview {
  code: string;
  discount_type: string;
  description: string | null;
  subtotal: number;
  delivery_fee: number;
  discount_amount: number;
  birthday_discount_amount: number;
  referral_discount_amount: number;
  applied_discount: 'COUPON' | 'BIRTHDAY' | 'REFERRAL';
  total: number;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_snapshot: string | null;
  unit_selling_price: number;
  quantity: number;
  subtotal: number;
  item_status: string;
  order_combo_id?: string | null;
}

/** One combo pack line of an order (order_combos; its items carry order_combo_id). */
export interface OrderCombo {
  id: string;
  combo_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  items_regular_total: number;
}

export interface OrderHistoryEntry {
  id: string; order_id: string; old_status: OrderStatus | null; new_status: OrderStatus; created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_method: string;
  payment_status: string;
  subtotal_amount: number;
  delivery_fee: number;
  discount_amount: number;
  birthday_discount_amount: number;
  referral_discount_amount: number;
  points_discount_amount: number;
  coupon_code: string | null;
  total_amount: number;
  free_delivery_reason?: 'BASKET_THRESHOLD' | 'NEW_CUSTOMER' | null;
  scheduled_for: string | null;
  /** The end of a booked delivery slot (null = as soon as possible). */
  scheduled_until?: string | null;
  /** Owner, 2026-10-12: sent to a receiver for this order only. */
  ordered_for_someone_else?: boolean;
  /** "Needs help at the door". */
  delivery_needs_help?: boolean;
  delivery_recipient_name: string | null;
  delivery_recipient_phone: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_instructions: string | null;
  /**
   * The delivery point (GET /orders/:id selects every orders column). Postgres DECIMAL columns
   * reach the app as strings ("7.4831"), so read them through destinationOf (tracking), which
   * accepts either; null/absent on an older server.
   */
  delivery_latitude?: number | string | null;
  delivery_longitude?: number | string | null;
  placed_at: string | null;
  created_at: string;
  can_cancel: boolean;
  items: OrderItem[];
  /** Combo packs in this order (migration 033; absent on an older server). */
  combos?: OrderCombo[];
  history?: OrderHistoryEntry[];
  delivery?: { assignment_status: string; assigned_at: string | null; picked_up_at: string | null; delivered_at: string | null } | null;
  /** GET /orders/:id only, while OUT_FOR_DELIVERY. */
  delivery_code?: string | null;
  rider_contact?: { first_name: string | null; phone: string } | null;
}

export interface OrderList {
  orders: Order[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

/** The POST /orders body this app sends (a subset of createOrderSchema). */
export interface PlaceOrderBody {
  address_id: string;
  items: { product_id: string; quantity: number }[];
  /** Combo packs (migration 033): the server charges the combo price. */
  combos?: { combo_id: string; quantity: number }[];
  idempotency_key: string;
  coupon_code?: string;
  delivery_note?: string;
  /** A slot start from GET /orders/slots; omitted = as soon as possible. */
  delivery_slot_start?: string;
  /** "Use points": the server decides how many. */
  use_points?: boolean;
  for_someone_else?: boolean;
  recipient?: { name: string; phone: string };
  needs_help?: boolean;
}
