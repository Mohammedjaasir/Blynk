import type { OnlinePaymentInfo } from '@/blynk/api/types';
import type { OrderWallet } from '@/blynk/wallet/models';

/*
 * The customer order contract (backend/api/src/modules/orders): GET /orders/checkout-info,
 * POST /orders, GET /orders, GET /orders/:id, POST /orders/:id/cancel. Cash on delivery is the
 * default; "Pay online" (payment_method ONLINE, PayHere - docs/api/payhere.md) creates the order
 * AWAITING_PAYMENT until a verified PayHere notification marks it PLACED + PAID.
 */

export type OrderStatus =
  | 'AWAITING_PAYMENT' | 'PLACED' | 'PACKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'FAILED'
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
  /**
   * 2026-10-25 small-order fee (absent on an older server = off). `applies` is null without ?subtotal=;
   * `charged_lkr` is the fee when it applies else 0; `remaining_lkr` is what is still to add to avoid it.
   */
  small_order_fee?: {
    enabled: boolean; min_subtotal_lkr: number; fee_lkr: number;
    applies: boolean | null; charged_lkr: number; remaining_lkr: number | null;
  };
  coupons_enabled: boolean;
  free_delivery: FreeDeliveryStatus;
  basket_free_delivery?: BasketFreeDeliveryStatus;
  /** Owner, 2026-10-12: whether checkout offers "For someone else" (absent on an older server = off). */
  order_for_someone_else?: { enabled: boolean; send_code_to_receiver: boolean };
  birthday_offer?: { eligible?: boolean; percent?: number; [k: string]: unknown };
  /** PayHere: whether "Pay online" is offered (absent on an older server = off). */
  online_payment?: OnlinePaymentInfo;
  referral_reward?: { available: boolean; side: string | null; mode: string | null; amount_lkr: number };
  points?: {
    enabled: boolean; balance: number; value_lkr: number; earn_points?: number; earn_per_lkr?: number;
    lkr_per_point?: number; min_redeem_points?: number; max_redeem_percent?: number; [k: string]: unknown;
  };
  /**
   * Migration 045: with ?product_ids= the cart's longest delivery lead time and its first
   * delivery day. asap_allowed false = the customer must pick a slot on/after that day.
   */
  delivery_lead?: DeliveryLead;
  /** Blynk Wallet (docs/api/wallet.md): "Use wallet balance" while enabled and balance > 0 (absent on an older server = off). */
  wallet?: { enabled: boolean; balance: number; max_use_percent: number };
  /** Migration 055: the rider tip chips ([50, 100, 200]); absent = tips not offered (src/blynk/ratings/model.ts). */
  tip_options?: number[];
}

export interface DeliveryLead {
  lead_days: number;
  /** YYYY-MM-DD (Asia/Colombo). */
  earliest_delivery_date: string | null;
  /** "Fri 16 Oct". */
  earliest_delivery_label: string | null;
  asap_allowed: boolean;
}

/** POST /orders/validate-coupon data.coupon. */
export interface CouponPreview {
  code: string;
  discount_type: string;
  description: string | null;
  subtotal: number;
  delivery_fee: number;
  /** 2026-10-25: the small-order fee the server added to `total` (0 / absent = none). */
  small_order_fee_lkr?: number;
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
  /** Migration 045: the size ordered and its label ("100 g"); null for a product without sizes. */
  variant_id?: string | null;
  variant_label_snapshot?: string | null;
  /** Bundle offers (migration 062): a free unit or a gift is its own line at price 0. Absent on an older server. */
  is_bundle_free?: boolean;
  bundle_kind?: 'FREE_UNITS' | 'GIFT' | null;
  bundle_offer_id?: string | null;
  bundle_title?: string | null;
  /** What the line would have cost (LKR); null when it is not a bundle line. */
  bundle_value?: number | null;
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
  /** 'COD' | 'ONLINE'. */
  payment_method: string;
  /** 'PENDING' | 'PAID' | 'FAILED' (last online attempt failed; may still be paid until expiry) | 'REFUNDED'. */
  payment_status: string;
  /** ONLINE orders: pay by this time, or the worker cancels the order. */
  payment_expires_at?: string | null;
  /** GET /orders/:id: the payment row (gateway fields for ONLINE orders). */
  payment?: { gateway?: string | null; gateway_method?: string | null; gateway_status_message?: string | null; failed_at?: string | null; [k: string]: unknown } | null;
  subtotal_amount: number;
  delivery_fee: number;
  /** 2026-10-25: the small-order fee charged on this order (already inside total_amount; 0 / absent = none). */
  small_order_fee?: number;
  discount_amount: number;
  birthday_discount_amount: number;
  referral_discount_amount: number;
  points_discount_amount: number;
  /** Bundle offers (migration 062): what free units and gifts saved on this order (absent / 0 = none). */
  bundle_savings?: number;
  bundle_applied?: { offer_id: string; title: string; type: string; savings_lkr: number; free_units?: number }[];
  coupon_code: string | null;
  /**
   * What is still to pay (cash to the rider, or the amount sent to PayHere). The order's full
   * value is total_amount + wallet_amount_used.
   */
  total_amount: number;
  /** Blynk Wallet: what the wallet paid for the order (a payment, not a discount; 0 = none). */
  wallet_amount_used: number;
  /** GET /orders/:id and POST /orders/:id/cancel: what the wallet paid and the refunds credited back to it. */
  wallet?: OrderWallet | null;
  free_delivery_reason?: 'BASKET_THRESHOLD' | 'NEW_CUSTOMER' | null;
  /**
   * POST /orders and GET /orders/:id (owner, 2026-10-14): the Blynk Points this order earns once
   * delivered (what it earned, once delivered; 0 while the program is off or cancelled).
   */
  points_earn_preview?: number;
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
  /** variant_id (migration 045): the size picked; required for a product with variants. */
  items: { product_id: string; variant_id?: string; quantity: number }[];
  /** Combo packs (migration 033): the server charges the combo price. */
  combos?: { combo_id: string; quantity: number }[];
  idempotency_key: string;
  coupon_code?: string;
  delivery_note?: string;
  /** A slot start from GET /orders/slots; omitted = as soon as possible. */
  delivery_slot_start?: string;
  /** "Use points": the server decides how many. */
  use_points?: boolean;
  /** "Use wallet balance": the server decides how much (after the coupon and points). */
  use_wallet?: boolean;
  for_someone_else?: boolean;
  recipient?: { name: string; phone: string };
  needs_help?: boolean;
  /** Omitted = cash on delivery. ONLINE = PayHere (the order waits for payment). */
  payment_method?: 'COD' | 'ONLINE';
  /** Migration 055: a tip for the rider (0-1000 LKR), collected in cash with the order. Omitted = none. */
  rider_tip_lkr?: number;
}
