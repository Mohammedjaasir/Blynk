import { Generated, ColumnType } from 'kysely';

/** OPERATIONS added by migration 014 (Operations-app-only staff). */
export type UserRole = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN' | 'OPERATIONS' | 'SELLER';
export type InventoryTrackingMode = 'UNTRACKED' | 'TRACKED';
export type InventoryAdjustmentType =
  | 'PURCHASE_RESTOCK'
  | 'ORDER_RESERVATION'
  | 'ORDER_FULFILLMENT'
  | 'ORDER_CANCELLATION_RESTORE'
  | 'DAMAGE_WRITE_OFF'
  | 'INVENTORY_AUDIT_ADJUSTMENT';

export type OrderStatus =
  // Migration 047: an ONLINE order waiting for PayHere's verified notification.
  | 'AWAITING_PAYMENT'
  | 'PLACED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE';

export type ItemFulfillmentStatus =
  | 'PENDING'
  | 'SOURCED'
  | 'PACKED'
  | 'UNAVAILABLE'
  | 'SUBSTITUTED';

export type PaymentMethod = 'COD' | 'ONLINE';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type DeliveryAssignmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'REJECTED';

/** Migration 029: a rider's application state. */
export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
/** Migration 032 (owner, 2026-10-09): salaried company rider, or a share of each delivery charge. */
export type RiderPayType = 'COMPANY' | 'COMMISSION';
/** Migration 038 (owner, 2026-10-10): how a COMMISSION rider's delivery pay is worked out. */
export type RiderPayModel = 'PERCENT' | 'FIXED' | 'DISTANCE';
export type RiderBonusKind = 'PEAK_BOOST' | 'RAIN_BOOST' | 'LONG_DISTANCE' | 'DAILY_TARGET';
export type RiderAdjustmentReason = 'CASH_SHORT' | 'DAMAGED_ITEM' | 'LATE' | 'BONUS' | 'OTHER';
export type NotificationChannel = 'SMS' | 'WHATSAPP' | 'IN_APP' | 'EMAIL' | 'PUSH';
export type NotificationStatus = 'QUEUED' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED';

/** Migration 030 (owner, 2026-10-09): a doctor's specialty is free text
 * (VARCHAR(64)), e.g. "Orthodontist" or "Cosmetic dentist". */
export type DentalSpecialty = string;

export type DentalAppointmentStatus =
  | 'HELD'
  | 'EXPIRED'
  | 'CONFIRMED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_CLINIC';

export interface SystemConfigurationsTable {
  key: string;
  value: unknown;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DarkStoresTable {
  id: Generated<string>;
  code: string;
  name: string;
  city: string;
  address_line: string;
  latitude: ColumnType<number, number | string, number | string>;
  longitude: ColumnType<number, number | string, number | string>;
  radius_km: ColumnType<number, number | string, number | string>;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ServiceAreasTable {
  id: Generated<string>;
  dark_store_id: string;
  area_name: string;
  center_latitude: ColumnType<number, number | string, number | string>;
  center_longitude: ColumnType<number, number | string, number | string>;
  radius_meters: number;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  email: string | null;
  full_name: string | null;
  role: Generated<UserRole>;
  is_active: Generated<boolean>;
  phone_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  /** Migration 012: staff password (bcrypt via pgcrypto) and its lockout. */
  staff_password_hash: string | null;
  login_failed_attempts: Generated<number>;
  login_locked_until: Date | null;
  /** Migration 014: set when an admin disables a staff account (no sign-in, no refresh). */
  staff_disabled_at: Date | null;
  /** Migration 027: the customer's SMS language; null until they pick one. */
  sms_language: SmsLanguage | null;
  /** Migration 027: set when the customer turns "Offers by SMS" off. */
  sms_offers_opted_out_at: Date | null;
  /**
   * Migration 034 (owner, 2026-10-09): the optional profile. A DATE with no
   * time - read it as text (`date_of_birth::text`, YYYY-MM-DD) so no time
   * zone ever shifts the day.
   */
  date_of_birth: ColumnType<Date | string | null, string | null | undefined, string | null>;
  favourite_category_ids: ColumnType<string[], string[] | undefined, string[]>;
  favourites_note: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 041 (security audit 2026-10): hex HMAC-SHA256 of the normalised
   * phone, kept when the account is deleted so per-customer promotion limits
   * survive delete + re-register (users/phone-identity.ts).
   */
  phone_hash: ColumnType<string | null, string | null | undefined, string | null>;
}

/** Migration 027: the languages an offer SMS can be written in. */
export type SmsLanguage = 'si' | 'ta' | 'en';

/** Migration 043: why an order's delivery fee was waived. */
export type FreeDeliveryReason = 'NEW_CUSTOMER' | 'BASKET_THRESHOLD';

/** Migration 027: who an SMS offer goes to. */
export type SmsOfferAudience = 'ALL' | 'ORDERED_30D' | 'ORDERED_90D' | 'NEVER_ORDERED';

/** Migration 027: one SMS offer as sent by Admin or Operations. */
export interface SmsOffersTable {
  id: Generated<string>;
  created_by: string | null;
  audience: SmsOfferAudience;
  fallback_language: SmsLanguage;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  recipient_count: Generated<number>;
  sms_parts_total: Generated<number>;
  created_at: Generated<Date>;
}

export interface OtpVerificationsTable {
  id: Generated<string>;
  phone: string;
  otp_hash: string;
  purpose: Generated<string>;
  attempts_count: Generated<number>;
  max_attempts: Generated<number>;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface CustomerAddressesTable {
  id: Generated<string>;
  user_id: string;
  label: Generated<string>;
  recipient_name: string;
  recipient_phone: string;
  /** Migration 024: optional second number for the rider; E.164, never equal to recipient_phone. */
  alternate_phone: ColumnType<string | null, string | null | undefined, string | null>;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string | null;
  latitude: ColumnType<number, number | string, number | string>;
  longitude: ColumnType<number, number | string, number | string>;
  delivery_instructions: string | null;
  is_default: Generated<boolean>;
  is_deleted: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  /** Migration 010: which point of the category image must stay visible. */
  image_focal_x: Generated<number>;
  image_focal_y: Generated<number>;
  /** Migration 017: set when a category is deleted but must be kept (its products are in order history). */
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /** Migration 025: the home-screen group this category's tile sits in (null -> "More"). */
  group_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 025: position inside that group. */
  group_sort_order: Generated<number>;
  /** Migration 026: the category this one sits inside (one level only; null -> top level). */
  parent_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 033 (owner, 2026-10-09): % off everything in the category (0 < x < 100); null = no offer. */
  offer_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** Migration 033: when the category offer stops; null runs until removed. */
  offer_ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /**
   * Migration 044 (owner, 2026-10-13): the markup for MARKUP products in this
   * category (0..999.99) without their own; null = the parent's, else global.
   */
  markup_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
}

/** Migration 025: a heading on the customer home over a grid of category tiles. */
export interface CategoryGroupsTable {
  id: Generated<string>;
  name: string;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface ProductsTable {
  id: Generated<string>;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  // Migration 009: where the crop anchors when the photo is drawn into a
  // fixed shape, as a percentage of the image's own width/height. 50/50 is
  // the centre, which is exactly what `cover` did before these existed.
  image_focal_x: Generated<number>;
  image_focal_y: Generated<number>;
  purchase_cost: ColumnType<number, number | string, number | string>;
  custom_markup_percent: ColumnType<number | null, number | string | null, number | string | null>;
  is_available: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  /**
   * Migration 017: a product deleted after it was ordered. Hidden from every
   * list (v_product_catalog skips it) and never orderable again; the row stays
   * for order history.
   */
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /**
   * Migration 031 (owner, 2026-10-09): the reduced price while the product is
   * on offer, and when the offer stops (null = until removed). Null price =
   * no offer. Active rule: src/modules/catalog/catalog.offers.ts.
   */
  offer_price: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  offer_ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /**
   * Migration 044 (owner, 2026-10-13): how the selling price is set - 'MARKUP'
   * (cost x markup; custom, else category, parent, global) or 'FIXED'
   * (fixed_selling_price exactly). Rule: src/modules/pricing/index.ts.
   */
  pricing_mode: ColumnType<'MARKUP' | 'FIXED', 'MARKUP' | 'FIXED' | undefined, 'MARKUP' | 'FIXED'>;
  fixed_selling_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 035 (owner, 2026-10-10): the product's place in its category,
   * 1..n, set by the Arrange products screen. NULL = not arranged (after the
   * arranged ones, A-Z).
   */
  display_order: ColumnType<number | null, number | null | undefined, number | null>;
  /**
   * Migration 045 (owner, 2026-10-14): the earliest delivery is today + N
   * days (0 = same day / as soon as possible). Variants inherit it.
   */
  delivery_lead_days: ColumnType<number, number | undefined, number>;
  /**
   * Migration 048 (owner, 2026-10-14): the MRP (Maximum Retail Price), > 0;
   * NULL = none. The selling price is capped at it (pricing/index.ts capAtMrp).
   */
  mrp: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 050 (owner, 2026-10-18): whether the customer app shows the
   * struck "was" price and the saving for this product. Default true.
   */
  show_offer_cut: ColumnType<boolean, boolean | undefined, boolean>;
  /** Migration 052: the seller who supplies it (NULL = Blynk's own). */
  seller_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * Migration 045 (owner, 2026-10-14): a product's sizes/packs ('50 g', '3 pack'),
 * each with its own cost, pricing, offer and stock. Price rule:
 * src/modules/pricing/index.ts resolveVariantPrice.
 */
export interface ProductVariantsTable {
  id: Generated<string>;
  product_id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  sort_order: Generated<number>;
  purchase_cost: ColumnType<string, number | string, number | string>;
  pricing_mode: ColumnType<'MARKUP' | 'FIXED', 'MARKUP' | 'FIXED' | undefined, 'MARKUP' | 'FIXED'>;
  fixed_selling_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  custom_markup_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  offer_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  offer_ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  is_active: Generated<boolean>;
  is_available: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /** Migration 048: this size's own MRP (NULL = none; the product's MRP does not apply to it). */
  mrp: ColumnType<string | null, number | string | null | undefined, number | string | null>;
}

export interface InventoryTable {
  id: Generated<string>;
  dark_store_id: string;
  product_id: string;
  /** Migration 045: the variant this stock row counts; null = the product-level row. */
  variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  tracking_mode: Generated<InventoryTrackingMode>;
  quantity_on_hand: Generated<number>;
  quantity_reserved: Generated<number>;
  low_stock_threshold: Generated<number>;
  updated_at: Generated<Date>;
}

export interface InventoryAdjustmentsTable {
  id: Generated<string>;
  inventory_id: string;
  adjustment_type: InventoryAdjustmentType;
  quantity_delta: number;
  previous_quantity: number;
  new_quantity: number;
  reference_order_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface OrdersTable {
  id: Generated<string>;
  order_number: string;
  idempotency_key: string;
  customer_id: string;
  dark_store_id: string;
  order_status: Generated<OrderStatus>;
  payment_method: Generated<PaymentMethod>;
  payment_status: Generated<PaymentStatus>;
  subtotal_amount: ColumnType<number, number | string, number | string>;
  delivery_fee: ColumnType<number, number | string, number | string>;
  /**
   * Migration 032: the standard delivery fee in effect when the order was
   * placed (delivery_fee is 0 for a free delivery). A commission rider's share
   * is of this. Null only on rows written outside order creation.
   */
  standard_delivery_fee: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 040 (owner, 2026-10-10): how standard_delivery_fee was worked
   * out - FLAT or DISTANCE_TIERS, and for tiers the road km hub -> address
   * (estimated = straight line x 1.3, OSRM unavailable). NULL on older orders.
   */
  delivery_fee_mode: ColumnType<'FLAT' | 'DISTANCE_TIERS' | null, 'FLAT' | 'DISTANCE_TIERS' | null | undefined, 'FLAT' | 'DISTANCE_TIERS' | null>;
  delivery_distance_km: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  delivery_distance_estimated: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  total_amount: ColumnType<number, number | string, number | string>;
  /** Migration 018: coupon discount snapshot; total = subtotal + delivery_fee - discount_amount. */
  discount_amount: ColumnType<number, number | string | undefined, number | string>;
  coupon_code: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 034: the part of discount_amount that is the birthday gift (0
   * or all of it - the gift and a coupon never stack).
   */
  birthday_discount_amount: ColumnType<number, number | string | undefined, number | string>;
  /** Migration 037 (owner, 2026-10-10): the part of discount_amount that is a referral reward. */
  referral_discount_amount: ColumnType<number, number | string | undefined, number | string>;
  /** Migration 037: Blynk Points used on the order and the LKR they took off (part of discount_amount). */
  points_redeemed: ColumnType<number, number | undefined, number>;
  points_discount_amount: ColumnType<number, number | string | undefined, number | string>;
  /**
   * Migration 049 (owner, 2026-10-15): what the Blynk Wallet paid for the
   * order - a payment, not a discount: total_amount = subtotal + delivery_fee
   * - discount_amount - wallet_amount_used is what is still to pay.
   */
  wallet_amount_used: ColumnType<number, number | string | undefined, number | string>;
  /**
   * Migration 055 (owner, 2026-10-24): a tip for the rider added at checkout,
   * collected in cash with the order (part of total_amount, not of the items
   * or the delivery fee). Absent before 055 - read as 0 (modules/ratings).
   */
  rider_tip: ColumnType<number, number | string | undefined, number | string>;
  /** Migration 055: a tip paid after delivery from the Blynk Wallet (not part of total_amount) and when. */
  rider_tip_wallet: ColumnType<number, number | string | undefined, number | string>;
  rider_tip_wallet_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /**
   * Migration 063 (owner's brother, 2026-10-25): the small-order fee charged on this order, snapshotted
   * separately from delivery_fee (total_amount includes it). Absent before 063 - read as 0.
   */
  small_order_fee: ColumnType<number, number | string | undefined, number | string>;
  scheduled_for: Date | null;
  /** Migration 036 (owner, 2026-10-10): end of the delivery slot the customer picked; scheduled_for is its start. */
  scheduled_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  /** Migration 024: snapshot of the address's alternate_phone at order creation. */
  delivery_alternate_phone: ColumnType<string | null, string | null | undefined, string | null>;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_postal_code: string | null;
  delivery_latitude: ColumnType<number, number | string, number | string>;
  delivery_longitude: ColumnType<number, number | string, number | string>;
  delivery_instructions: string | null;
  /**
   * Migration 042 (owner, 2026-10-12): the buyer marked the order "For someone
   * else"; delivery_recipient_* is then the receiver they typed for this order.
   */
  ordered_for_someone_else: ColumnType<boolean, boolean | undefined, boolean>;
  /** Migration 042: "Elderly / needs help - knock and wait, carry items inside". */
  delivery_needs_help: ColumnType<boolean, boolean | undefined, boolean>;
  /**
   * Migration 043 (owner, 2026-10-12): why delivery_fee is 0 - one of the
   * customer's free deliveries, or the basket amount (which never uses one up).
   */
  free_delivery_reason: ColumnType<FreeDeliveryReason | null, FreeDeliveryReason | null | undefined, FreeDeliveryReason | null>;
  /** Migration 047: an unpaid ONLINE order is cancelled after this moment. */
  payment_expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** Migration 054 (owner, 2026-10-24): the repeat basket this order was placed from (NULL = ordinary). */
  repeat_basket_id: ColumnType<string | null, string | null | undefined, string | null>;
  cancellation_reason: string | null;
  cancelled_by_user_id: string | null;
  cancelled_at: Date | null;
  customer_notes: string | null;
  internal_notes: string | null;
  placed_at: Generated<Date>;
  packed_at: Date | null;
  dispatched_at: Date | null;
  delivered_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderItemsTable {
  id: Generated<string>;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  unit_snapshot: string;
  unit_selling_price: ColumnType<number, number | string, number | string>;
  estimated_unit_cost: ColumnType<number, number | string, number | string>;
  actual_unit_cost: ColumnType<number | null, number | string | null, number | string | null>;
  markup_percentage_applied: ColumnType<number, number | string, number | string>;
  quantity: number;
  subtotal: ColumnType<number, number | string, number | string>;
  item_status: Generated<ItemFulfillmentStatus>;
  created_at: Generated<Date>;
  /** Migration 033: the combo line this item was packed for; null for a loose item. */
  order_combo_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 045: the variant ordered (null = the product itself) and its label then. */
  variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  variant_label_snapshot: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 048: the product's / size's MRP when ordered (NULL = none). Reporting only. */
  mrp_snapshot: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** Migration 062 (owner, 2026-10-25): the bundle offer that made this row (a free unit or a gift, price 0); NULL = an ordinary item. */
  bundle_offer_id: ColumnType<string | null, string | null | undefined, string | null>;
  bundle_kind: ColumnType<'FREE_UNITS' | 'GIFT' | null, 'FREE_UNITS' | 'GIFT' | null | undefined, 'FREE_UNITS' | 'GIFT' | null>;
  bundle_title: ColumnType<string | null, string | null | undefined, string | null>;
  /** What the row would have cost (the savings), LKR. */
  bundle_value: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  /** The rule as it applied, so a removed item can recompute the free units (JSON text on write). */
  bundle_rule: ColumnType<unknown, string | null | undefined, string | null>;
}

/** Migration 033 (owner, 2026-10-09): a combo pack - several products at one price. */
export interface CombosTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  image_url: string | null;
  price: ColumnType<number, number | string, number | string>;
  is_active: Generated<boolean>;
  ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  display_order: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface ComboItemsTable {
  /** Migration 045: surrogate key (was PRIMARY KEY (combo_id, product_id)). */
  id: Generated<string>;
  combo_id: string;
  product_id: string;
  /** Migration 045: a specific variant of the product; null = the product itself. */
  variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  quantity: number;
  sort_order: Generated<number>;
}

/** Migration 033: a combo as ordered (snapshot); its items are order_items with order_combo_id. */
export interface OrderCombosTable {
  id: Generated<string>;
  order_id: string;
  combo_id: string | null;
  combo_name_snapshot: string;
  unit_price: ColumnType<number, number | string, number | string>;
  quantity: number;
  subtotal: ColumnType<number, number | string, number | string>;
  items_regular_total: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
}

export interface OrderStatusHistoryTable {
  id: Generated<string>;
  order_id: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by_user_id: string | null;
  reason_or_notes: string | null;
  created_at: Generated<Date>;
}

export interface PaymentsTable {
  id: Generated<string>;
  order_id: string;
  payment_method: Generated<PaymentMethod>;
  payment_status: Generated<PaymentStatus>;
  amount: ColumnType<number, number | string, number | string>;
  transaction_reference: string | null;
  gateway_response: unknown | null;
  paid_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  // Migration 047 (PayHere).
  gateway: ColumnType<string | null, string | null | undefined, string | null>;
  gateway_payment_id: ColumnType<string | null, string | null | undefined, string | null>;
  gateway_status_code: ColumnType<number | null, number | null | undefined, number | null>;
  gateway_method: ColumnType<string | null, string | null | undefined, string | null>;
  gateway_status_message: ColumnType<string | null, string | null | undefined, string | null>;
  refund_required: ColumnType<boolean, boolean | undefined, boolean>;
  failed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

/** Migration 047: one row per payment provider; the secret only ever encrypted. */
export interface PaymentGatewaySettingsTable {
  provider: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  mode: ColumnType<'sandbox' | 'live', 'sandbox' | 'live' | undefined, 'sandbox' | 'live'>;
  merchant_id: string | null;
  merchant_secret_encrypted: string | null;
  merchant_secret_updated_at: Date | null;
  allowed_methods: string | null;
  payment_window_minutes: ColumnType<number, number | undefined, number>;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Migration 047: every PayHere notify_url call (no card data, no secret). */
export interface PaymentNotificationsTable {
  id: Generated<string>;
  provider: ColumnType<string, string | undefined, string>;
  order_id: string | null;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  status_code: number | null;
  amount: ColumnType<string | null, number | string | null, number | string | null>;
  currency: string | null;
  method: string | null;
  signature_valid: boolean;
  outcome: string;
  received_at: Generated<Date>;
}

export interface RidersTable {
  id: Generated<string>;
  user_id: string;
  dark_store_id: string;
  vehicle_type: Generated<string>;
  /** NULL only for a BICYCLE (migration 029). */
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
  is_available: Generated<boolean>;
  is_active: Generated<boolean>;
  /** Migration 029: riders apply in the Rider app; only APPROVED riders work. */
  approval_status: Generated<RiderApprovalStatus>;
  applied_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  /** Migration 032: COMPANY (default) or COMMISSION. */
  pay_type: Generated<RiderPayType>;
  /** Migration 032: this rider's own share of the delivery charge, 0..100; null = the store default. */
  commission_percent: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 038 (owner, 2026-10-10): this rider's own pay model (null =
   * the store default) and own numbers (each null = the store default's).
   */
  pay_model: ColumnType<RiderPayModel | null, RiderPayModel | null | undefined, RiderPayModel | null>;
  pay_fixed_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  pay_base_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  pay_per_km_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  pay_min_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 040 (owner, 2026-10-10): DISTANCE pay as base + per km (LINEAR)
   * or per-km tiers (TIERS); null = the store default's. pay_km_tiers is the
   * rider's own tier table [{km, lkr}], null = the store default's.
   */
  pay_distance_mode: ColumnType<'LINEAR' | 'TIERS' | null, 'LINEAR' | 'TIERS' | null | undefined, 'LINEAR' | 'TIERS' | null>;
  pay_km_tiers: ColumnType<unknown | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveriesTable {
  id: Generated<string>;
  order_id: string;
  rider_id: string;
  assignment_status: Generated<DeliveryAssignmentStatus>;
  cod_collected_amount: ColumnType<number, number | string | undefined, number | string>;
  handover_notes: string | null;
  assigned_at: Generated<Date>;
  accepted_at: Date | null;
  picked_up_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  current_latitude: ColumnType<number, number | string, number | string> | null;
  current_longitude: ColumnType<number, number | string, number | string> | null;
  location_accuracy_m: ColumnType<number, number | string, number | string> | null;
  location_captured_at: Date | null;
  location_received_at: Date | null;
  /**
   * Migration 032: snapshot taken when the delivery is settled (settleCod) -
   * the rider's pay type, the share applied and what they earned. Null until
   * delivered.
   */
  rider_pay_type: ColumnType<RiderPayType | null, RiderPayType | null | undefined, RiderPayType | null>;
  rider_commission_percent: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  rider_earning_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  /**
   * Migration 038 (owner, 2026-10-10): the rest of the settlement snapshot -
   * the model and numbers applied, the store -> drop-off distance (estimated
   * = straight line x 1.3 when OSRM was down), the base pay and the
   * per-delivery bonuses. rider_earning_lkr = base + bonus.
   */
  rider_pay_model: ColumnType<RiderPayModel | null, RiderPayModel | null | undefined, RiderPayModel | null>;
  rider_pay_inputs: ColumnType<unknown | null, string | null | undefined, string | null>;
  rider_distance_km: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  rider_distance_estimated: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  rider_base_earning_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  rider_bonus_lkr: ColumnType<number | null, number | string | null | undefined, number | string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string | null;
  order_id: string | null;
  idempotency_key: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  payload: unknown;
  status: Generated<NotificationStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  locked_at: Date | null;
  locked_by: string | null;
  provider_name: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  failed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Migration 038 (owner, 2026-10-10): one bonus a rider earned. */
export interface RiderEarningLinesTable {
  id: Generated<string>;
  rider_id: string;
  /** Set for per-delivery bonuses; null for DAILY_TARGET (per day). */
  delivery_id: string | null;
  earning_date: ColumnType<string, string, string>;
  kind: RiderBonusKind;
  amount_lkr: ColumnType<number, number | string, number | string>;
  detail: ColumnType<unknown | null, string | null | undefined, string | null>;
  dedupe_key: string;
  created_at: Generated<Date>;
}

/** Migration 038 (owner, 2026-10-10): a staff +/- entry on a rider's pay. */
export interface RiderPayAdjustmentsTable {
  id: Generated<string>;
  rider_id: string;
  /** Signed: negative = deduction, positive = extra pay. */
  amount_lkr: ColumnType<number, number | string, number | string>;
  reason: RiderAdjustmentReason;
  note: string | null;
  adjustment_date: ColumnType<string, string, string>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: unknown | null;
  new_values: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface ProductCatalogView {
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
  purchase_cost: ColumnType<number, number | string, number | string>;
  custom_markup_percent: ColumnType<number | null, number | string | null, number | string | null>;
  /** Migration 044: for FIXED, the implied markup over cost (null when the cost is 0). */
  effective_markup_percent: ColumnType<number | null, number | string, number | string>;
  calculated_selling_price: ColumnType<number, number | string, number | string>;
  is_available: boolean;
  is_active: boolean;
  // Migration 009 appended these to the view so both the customer and admin
  // product reads carry the crop anchor with the image they describe.
  image_focal_x: number;
  image_focal_y: number;
  // Migration 031 appended the product offer (raw; may be ended).
  offer_price: ColumnType<number | null, never, never>;
  offer_ends_at: Date | null;
  // Migration 033 appended the best ACTIVE category offer (own category or
  // its parent); null when neither has one running.
  category_offer_percent: ColumnType<string | null, never, never>;
  category_offer_ends_at: Date | null;
  /** Migration 035 (owner, 2026-10-10): products.display_order. */
  display_order: number | null;
  // Migration 044: how the price is set and where the markup came from.
  // Staff reads only - never sent to customers.
  pricing_mode: 'MARKUP' | 'FIXED';
  fixed_selling_price: ColumnType<string | null, never, never>;
  category_markup_percent: ColumnType<string | null, never, never>;
  parent_category_markup_percent: ColumnType<string | null, never, never>;
  global_markup_percent: ColumnType<string | null, never, never>;
  pricing_source: 'FIXED' | 'PRODUCT_MARKUP' | 'CATEGORY_MARKUP' | 'PARENT_CATEGORY_MARKUP' | 'GLOBAL_MARKUP';
  // Migration 045. stock_* are staff reads only; customers get is_orderable
  // (as is_available), never a count.
  delivery_lead_days: number;
  has_variants: boolean;
  stock_tracked: boolean;
  stock_sellable: number | null;
  is_orderable: boolean;
  // Migration 048: calculated_selling_price above is capped at the MRP.
  // Staff reads: the MRP, the price before the cap, and whether it capped.
  mrp: ColumnType<string | null, never, never>;
  computed_selling_price: ColumnType<string, never, never>;
  mrp_capped: boolean;
}

/** Migration 045: each live variant of a live product, priced (resolveVariantPrice's SQL twin). */
export interface ProductVariantCatalogView {
  id: string;
  product_id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  purchase_cost: ColumnType<string, never, never>;
  pricing_mode: 'MARKUP' | 'FIXED';
  fixed_selling_price: ColumnType<string | null, never, never>;
  custom_markup_percent: ColumnType<string | null, never, never>;
  product_markup_percent: ColumnType<string | null, never, never>;
  category_markup_percent: ColumnType<string | null, never, never>;
  parent_category_markup_percent: ColumnType<string | null, never, never>;
  global_markup_percent: ColumnType<string | null, never, never>;
  effective_markup_percent: ColumnType<string | null, never, never>;
  calculated_selling_price: ColumnType<string, never, never>;
  pricing_source: 'FIXED' | 'VARIANT_MARKUP' | 'PRODUCT_MARKUP' | 'CATEGORY_MARKUP' | 'PARENT_CATEGORY_MARKUP' | 'GLOBAL_MARKUP';
  offer_price: ColumnType<string | null, never, never>;
  offer_ends_at: Date | null;
  category_offer_percent: ColumnType<string | null, never, never>;
  category_offer_ends_at: Date | null;
  is_active: boolean;
  is_available: boolean;
  product_is_active: boolean;
  product_is_available: boolean;
  delivery_lead_days: number;
  created_at: Date;
  updated_at: Date;
  stock_tracked: boolean;
  stock_sellable: number | null;
  is_orderable: boolean;
  // Migration 048 (see ProductCatalogView).
  mrp: ColumnType<string | null, never, never>;
  computed_selling_price: ColumnType<string, never, never>;
  mrp_capped: boolean;
}

/** Migration 045: inventory rows with units in open (unpacked) orders and what is left to sell. */
export interface InventoryStockView {
  inventory_id: string;
  dark_store_id: string;
  product_id: string;
  variant_id: string | null;
  tracking_mode: InventoryTrackingMode;
  quantity_on_hand: number;
  quantity_reserved: number;
  low_stock_threshold: number;
  updated_at: Date;
  quantity_in_open_orders: number;
  quantity_sellable: number;
}

export interface SuppliersTable {
  id: Generated<string>;
  name: string;
  code: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SourcingRecordsTable {
  id: Generated<string>;
  order_id: string;
  order_item_id: string;
  product_id: string;
  supplier_id: string | null;
  quantity_sourced: number;
  estimated_unit_cost: ColumnType<number, number | string, number | string>;
  actual_unit_cost: ColumnType<number, number | string, number | string>;
  sourcing_status: Generated<ItemFulfillmentStatus>;
  notes: string | null;
  sourced_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PromotionsTable {
  id: Generated<string>;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  // Migration 008 widened the CHECK constraint to include ARTWORK: a
  // finished banner drawn full-bleed, with no scrim and none of the app's
  // own words over it. It stores its file in background_image_url, exactly
  // as IMAGE does.
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  // Migration 009: the crop anchor for background_image_url, shared by IMAGE
  // and ARTWORK because they share the file. 50/50 is the centre.
  background_focal_x: Generated<number>;
  background_focal_y: Generated<number>;
  cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DentalClinicsTable {
  id: Generated<string>;
  name: string;
  city: string;
  address_line: string;
  latitude: ColumnType<number, number | string, number | string>;
  longitude: ColumnType<number, number | string, number | string>;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DoctorsTable {
  id: Generated<string>;
  full_name: string;
  specialty: DentalSpecialty;
  photo_url: string | null;
  bio: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ClinicDoctorsTable {
  id: Generated<string>;
  clinic_id: string;
  doctor_id: string;
  consultation_fee: ColumnType<number | null, number | string | null, number | string | null>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DoctorAvailabilityTable {
  id: Generated<string>;
  clinic_doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DoctorBlockedDatesTable {
  id: Generated<string>;
  clinic_doctor_id: string;
  blocked_date: ColumnType<string, string | Date, string | Date>;
  reason: string;
  created_by: string;
  created_at: Generated<Date>;
}

export interface AppointmentsTable {
  id: Generated<string>;
  clinic_doctor_id: string;
  customer_id: string;
  start_at: Date;
  end_at: Date;
  status: Generated<DentalAppointmentStatus>;
  held_by: string | null;
  held_until: Date | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_notes: string | null;
  consultation_fee_snapshot: ColumnType<number | null, number | string | null, number | string | null>;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  idempotency_key: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  /** Migration 023: the day-before reminder was handled (sent or skipped). */
  reminded_at: Generated<Date | null>;
  /** Migration 023: the post-visit "How was your visit?" push was handled. */
  rating_prompted_at: Generated<Date | null>;
}

/** Migration 023: one rating per visited appointment. */
export interface DoctorRatingsTable {
  id: Generated<string>;
  appointment_id: string;
  doctor_id: string;
  clinic_id: string;
  customer_id: string;
  stars: number;
  comment: string | null;
  created_at: Generated<Date>;
  hidden_at: Date | null;
  hidden_by: string | null;
}

export interface AppointmentStatusHistoryTable {
  id: Generated<string>;
  appointment_id: string;
  old_status: DentalAppointmentStatus | null;
  new_status: DentalAppointmentStatus;
  changed_by: string;
  created_at: Generated<Date>;
}

/** Migration 013: what a customer sends from Profile / Help -> Send feedback. */
export type FeedbackCategory = 'APP' | 'DELIVERY' | 'PRODUCTS' | 'OTHER';
export type FeedbackStatus = 'NEW' | 'READ';

export interface CustomerFeedbackTable {
  id: Generated<string>;
  user_id: string;
  rating: number | null;
  category: FeedbackCategory;
  message: string;
  status: Generated<FeedbackStatus>;
  created_at: Generated<Date>;
}

/** Migration 022: FCM registration tokens, one row per device. */
export type DevicePlatform = 'android' | 'ios' | 'web';

export interface DeviceTokensTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

/** Migration 022: "Notify me when it's back". Pending while notified_at is null. */
export interface StockAlertsTable {
  id: Generated<string>;
  user_id: string;
  product_id: string;
  created_at: Generated<Date>;
  notified_at: Date | null;
}

/** Migration 016: proof of delivery. Private to the customer detail and the lifecycle. */
export type DeliveryConfirmation = 'CODE' | 'OVERRIDE';

export interface OrderDeliveryCodesTable {
  order_id: string;
  code: string;
  failed_attempts: Generated<number>;
  locked_until: Date | null;
  confirmed_via: DeliveryConfirmation | null;
  confirmed_at: Date | null;
  confirmed_by_user_id: string | null;
  override_note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type CouponDiscountType = 'FIXED' | 'PERCENT' | 'FREE_DELIVERY';

/** Migration 018. */
export interface CouponsTable {
  id: Generated<string>;
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: ColumnType<number, number | string, number | string>;
  max_discount: ColumnType<number | null, number | string | null, number | string | null>;
  min_subtotal: ColumnType<number | null, number | string | null, number | string | null>;
  first_order_only: Generated<boolean>;
  starts_at: Date | null;
  ends_at: Date | null;
  usage_limit: number | null;
  per_customer_limit: Generated<number>;
  is_active: Generated<boolean>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Migration 018. */
export interface CouponRedemptionsTable {
  id: Generated<string>;
  coupon_id: string;
  order_id: string;
  customer_id: string;
  discount_amount: ColumnType<number, number | string, number | string>;
  released_at: Date | null;
  created_at: Generated<Date>;
}

/** Migration 034: an order that used the customer's birthday gift. */
export interface BirthdayOfferRedemptionsTable {
  id: Generated<string>;
  customer_id: string;
  order_id: string;
  /** The year of the birthday the gift is for. */
  offer_year: number;
  percent: ColumnType<number, number | string, number | string>;
  discount_amount: ColumnType<number, number | string, number | string>;
  created_at: Generated<Date>;
  /** Set when the order is cancelled: the gift can be used again. */
  released_at: Date | null;
}

/** Migration 019. */
export interface CashHandinsTable {
  id: Generated<string>;
  rider_id: string;
  amount: ColumnType<number, number | string, number | string>;
  /** Business day (Asia/Colombo), YYYY-MM-DD. */
  handin_date: ColumnType<string, string, string>;
  note: string | null;
  recorded_by_user_id: string | null;
  created_at: Generated<Date>;
}

/** Migration 052 (seller portal; docs/superpowers/specs/2026-10-23-seller-portal-design.md). */
export type SellerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
/** Migration 053: the latest shop-location request. */
export type SellerLocationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export interface SellersTable {
  id: Generated<string>;
  user_id: string;
  shop_name: string;
  contact_name: string | null;
  address: string | null;
  note: string | null;
  status: Generated<SellerStatus>;
  /** Migration 057: NULL = no own rate (the category's rate or the default applies; seller.commission.ts). */
  commission_percent: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  rejection_reason: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Migration 053 (shop pin that Admin approves). Only touched through seller.location.ts guards:
  // the API runs before the migration does, so a row may come back without them (pg returns
  // NUMERIC as a string).
  latitude: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  longitude: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  location_note: ColumnType<string | null, string | null | undefined, string | null>;
  pending_latitude: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  pending_longitude: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  pending_location_note: ColumnType<string | null, string | null | undefined, string | null>;
  location_status: ColumnType<SellerLocationStatus, SellerLocationStatus | undefined, SellerLocationStatus>;
  location_reject_reason: ColumnType<string | null, string | null | undefined, string | null>;
  location_reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  location_reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export type SellerSubmissionKind = 'NEW' | 'EDIT';
export type SellerSubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export interface SellerSubmissionsTable {
  id: Generated<string>;
  seller_id: string;
  product_id: ColumnType<string | null, string | null | undefined, string | null>;
  kind: SellerSubmissionKind;
  status: Generated<SellerSubmissionStatus>;
  /** name, category_id, unit, pack_size, description, image_url, barcode */
  payload: ColumnType<Record<string, unknown>, string | Record<string, unknown>, string | Record<string, unknown>>;
  seller_price: ColumnType<string, number | string, number | string>;
  approved_selling_price: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  reject_reason: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface SellerPayoutsTable {
  id: Generated<string>;
  seller_id: string;
  amount: ColumnType<string, number | string, number | string>;
  note: string | null;
  paid_on: ColumnType<Date, Date | string | undefined, Date | string>;
  created_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
}

/** Migration 054 (owner, 2026-10-24): "deliver this basket every Monday" (modules/repeat-baskets). */
export type RepeatFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY';
export type RepeatBasketStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export type RepeatRunStatus = 'PLACED' | 'SKIPPED' | 'FAILED';
export interface RepeatBasketLine {
  product_id: string;
  variant_id: string | null;
  quantity: number;
}
export interface RepeatBasketsTable {
  id: Generated<string>;
  user_id: string;
  name: ColumnType<string, string | undefined, string>;
  items: ColumnType<RepeatBasketLine[], string, string>;
  frequency: RepeatFrequency;
  weekday: number | null;
  place_at: string;
  start_date: ColumnType<string | null, string | null | undefined, string | null>;
  address_id: string | null;
  notes: string | null;
  status: ColumnType<RepeatBasketStatus, RepeatBasketStatus | undefined, RepeatBasketStatus>;
  skip_next: ColumnType<boolean, boolean | undefined, boolean>;
  next_run_at: Date | null;
  last_run_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  last_order_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface RepeatBasketRunsTable {
  id: Generated<string>;
  basket_id: string;
  run_at: Date;
  status: RepeatRunStatus;
  order_id: string | null;
  reason: string | null;
  created_at: Generated<Date>;
}

/** Migration 056 (owner, 2026-10-24): "Can't find it? Ask us" (modules/catalog/product-requests.ts). */
export type ProductRequestStatus = 'NEW' | 'PLANNED' | 'ADDED' | 'DECLINED';
export interface ProductRequestsTable {
  id: Generated<string>;
  user_id: string | null;
  name: string;
  /** Generated: lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))). */
  name_key: ColumnType<string, never, never>;
  note: string | null;
  category_id: string | null;
  photo_url: string | null;
  status: ColumnType<ProductRequestStatus, ProductRequestStatus | undefined, ProductRequestStatus>;
  product_id: string | null;
  staff_note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Migration 060 (owner, 2026-10-25): extra categories a product is also listed in (never its primary). */
export interface ProductCategoriesTable {
  product_id: string;
  category_id: string;
  created_at: Generated<Date>;
}

/** Migration 064 (owner's brother, 2026-10-27): the seller application form at blynk.lk/seller (modules/sellers/seller-applications.ts). */
export type SellerApplicationStatus = 'NEW' | 'CONTACTED' | 'APPROVED' | 'DECLINED';
export interface SellerApplicationsTable {
  id: Generated<string>;
  shop_name: string;
  owner_name: string;
  /** Normalized +94XXXXXXXXX. */
  phone: string;
  email: string | null;
  town: string;
  what_they_sell: string;
  message: string | null;
  status: ColumnType<SellerApplicationStatus, SellerApplicationStatus | undefined, SellerApplicationStatus>;
  staff_note: string | null;
  handled_by: string | null;
  handled_at: Date | null;
  source: ColumnType<string, string | undefined, string>;
  ip_hash: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface Database {
  seller_applications: SellerApplicationsTable;
  product_categories: ProductCategoriesTable;
  product_requests: ProductRequestsTable;
  sellers: SellersTable;
  seller_submissions: SellerSubmissionsTable;
  seller_payouts: SellerPayoutsTable;
  system_configurations: SystemConfigurationsTable;
  dark_stores: DarkStoresTable;
  service_areas: ServiceAreasTable;
  users: UsersTable;
  sms_offers: SmsOffersTable;
  otp_verifications: OtpVerificationsTable;
  refresh_tokens: RefreshTokensTable;
  customer_addresses: CustomerAddressesTable;
  categories: CategoriesTable;
  category_groups: CategoryGroupsTable;
  products: ProductsTable;
  product_variants: ProductVariantsTable;
  promotions: PromotionsTable;
  inventory: InventoryTable;
  inventory_adjustments: InventoryAdjustmentsTable;
  suppliers: SuppliersTable;
  sourcing_records: SourcingRecordsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  combos: CombosTable;
  combo_items: ComboItemsTable;
  order_combos: OrderCombosTable;
  order_status_history: OrderStatusHistoryTable;
  payments: PaymentsTable;
  payment_gateway_settings: PaymentGatewaySettingsTable;
  payment_notifications: PaymentNotificationsTable;
  riders: RidersTable;
  /** Migration 039 (owner, 2026-10-10). */
  rider_documents: RiderDocumentsTable;
  deliveries: DeliveriesTable;
  notifications: NotificationsTable;
  audit_logs: AuditLogsTable;
  rider_earning_lines: RiderEarningLinesTable;
  rider_pay_adjustments: RiderPayAdjustmentsTable;
  dental_clinics: DentalClinicsTable;
  doctors: DoctorsTable;
  clinic_doctors: ClinicDoctorsTable;
  doctor_availability: DoctorAvailabilityTable;
  doctor_blocked_dates: DoctorBlockedDatesTable;
  appointments: AppointmentsTable;
  appointment_status_history: AppointmentStatusHistoryTable;
  doctor_ratings: DoctorRatingsTable;
  customer_feedback: CustomerFeedbackTable;
  order_delivery_codes: OrderDeliveryCodesTable;
  coupons: CouponsTable;
  coupon_redemptions: CouponRedemptionsTable;
  birthday_offer_redemptions: BirthdayOfferRedemptionsTable;
  cash_handins: CashHandinsTable;
  device_tokens: DeviceTokensTable;
  stock_alerts: StockAlertsTable;
  v_product_catalog: ProductCatalogView;
  v_product_variant_catalog: ProductVariantCatalogView;
  v_inventory_stock: InventoryStockView;
  referral_codes: ReferralCodesTable;
  referrals: ReferralsTable;
  referral_rewards: ReferralRewardsTable;
  points_ledger: PointsLedgerTable;
  wallet_entries: WalletEntriesTable;
  /** Migration 054 (owner, 2026-10-24): repeat baskets. */
  repeat_baskets: RepeatBasketsTable;
  repeat_basket_runs: RepeatBasketRunsTable;
  /** Migration 055 (owner, 2026-10-24). */
  order_ratings: OrderRatingsTable;
  /** Migration 059 (owner, 2026-10-25): expiry dates. */
  stock_batches: StockBatchesTable;
}

/** Migration 055 (owner, 2026-10-24): a customer's rating of a delivered order (one per order). */
export interface OrderRatingsTable {
  order_id: string;
  user_id: string;
  rider_id: string | null;
  stars: number;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  comment: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Migration 039 (owner, 2026-10-10): a rider applicant's identity / vehicle
 * document. rider_id is NULL (and draft_phone set) until the application is
 * sent. Files live in private storage (RIDER_DOCUMENTS_ROOT).
 */
export type RiderDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export interface RiderDocumentImage {
  key: string;
  content_type: string;
  bytes: number;
  uploaded_at: string;
}
export interface RiderDocumentsTable {
  id: Generated<string>;
  rider_id: string | null;
  draft_phone: string | null;
  doc_type: string;
  custom_name: string | null;
  images: ColumnType<RiderDocumentImage[], string | undefined, string>;
  /** DATE: read as 'YYYY-MM-DD' text by the service (to_char). */
  expiry_date: ColumnType<Date | null, string | null | undefined, string | null>;
  status: Generated<RiderDocumentStatus>;
  reject_reason: string | null;
  reject_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Migration 037 (owner, 2026-10-10): a customer's personal referral code. */
export interface ReferralCodesTable {
  customer_id: string;
  code: string;
  created_at: Generated<Date>;
}

export type ReferralStatus = 'PENDING' | 'REWARDED' | 'CAPPED' | 'NO_REWARD';
export type ReferralRewardMode = 'LKR_OFF' | 'FREE_DELIVERY';

/** Migration 037: who invited whom (one referral per friend account). */
export interface ReferralsTable {
  id: Generated<string>;
  inviter_id: string;
  friend_id: string;
  code: string;
  status: ColumnType<ReferralStatus, ReferralStatus | undefined, ReferralStatus>;
  qualifying_order_id: string | null;
  completed_at: Date | null;
  created_at: Generated<Date>;
}

/** Migration 037: a referral reward, the friend's (used on the first order) or the inviter's credit. */
export interface ReferralRewardsTable {
  id: Generated<string>;
  referral_id: string;
  customer_id: string;
  side: 'FRIEND' | 'INVITER';
  mode: ReferralRewardMode;
  amount: ColumnType<number, number | string | undefined, number | string>;
  order_id: string | null;
  discount_amount: ColumnType<number, number | string | undefined, number | string>;
  used_at: Date | null;
  created_at: Generated<Date>;
}

export type PointsLedgerKind = 'EARN' | 'REDEEM' | 'REFUND' | 'EXPIRE' | 'ADJUST';

/** Migration 037: every change to a customer's Blynk Points (positive rows are lots). */
export interface PointsLedgerTable {
  id: Generated<string>;
  customer_id: string;
  kind: PointsLedgerKind;
  points: number;
  remaining: ColumnType<number, number | undefined, number>;
  expires_at: Date | null;
  order_id: string | null;
  reason: string | null;
  actor_user_id: string | null;
  created_at: Generated<Date>;
}

export type WalletEntryKind =
  | 'REFUND_ORDER_CANCELLED'
  | 'REFUND_ITEM'
  | 'REFUND_DELIVERY_FEE'
  | 'ADJUSTMENT'
  | 'ORDER_PAYMENT'
  | 'ORDER_PAYMENT_RETURNED'
  | 'EXPIRED'
  /** Migration 055: a tip for the rider paid from the wallet after delivery (one per order). */
  | 'RIDER_TIP';

/** Migration 049 (owner, 2026-10-15): the Blynk Wallet ledger, append-only and signed. */
export interface WalletEntriesTable {
  id: Generated<string>;
  customer_id: string;
  amount: ColumnType<number, number | string, never>;
  kind: WalletEntryKind;
  order_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  expires_at: Date | null;
}

/** Migration 059 (owner, 2026-10-25): a received batch and when it expires (a register, not a stock engine). */
export type StockBatchStatus = 'ACTIVE' | 'SOLD_OUT' | 'DISCARDED';
export interface StockBatchesTable {
  id: Generated<string>;
  product_id: string;
  variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  batch_code: ColumnType<string | null, string | null | undefined, string | null>;
  quantity: ColumnType<number, number, number>;
  /** 'YYYY-MM-DD' (Colombo calendar date); read it through to_char so no time zone shifts it. */
  expires_on: ColumnType<string, string, string>;
  status: ColumnType<StockBatchStatus, StockBatchStatus | undefined, StockBatchStatus>;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  received_at: Generated<Date>;
  created_by: ColumnType<string | null, string | null | undefined, string | null>;
  sold_out_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  discarded_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  discarded_by: ColumnType<string | null, string | null | undefined, string | null>;
  discard_reason: ColumnType<'EXPIRED' | 'WASTE' | null, 'EXPIRED' | 'WASTE' | null | undefined, 'EXPIRED' | 'WASTE' | null>;
  discard_stock_removed: ColumnType<number | null, number | null | undefined, number | null>;
  updated_at: Generated<Date>;
}
