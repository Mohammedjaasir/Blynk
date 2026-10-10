import type { ActiveDelivery, ItemsSummary, OrderStatus } from '../lib/orders';

/** Shapes returned by the Blynk API - mirrors of the backend DTOs. */

export type UserRole =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'PACKING_STAFF'
  | 'RIDER'
  | 'OPERATIONS'
  | 'SUPPORT';

/** Roles an existing account can be moved between (backend migration 014). */
export type StaffRole = 'PACKING_STAFF' | 'OPERATIONS';

/** Roles a new account can be created with (an ADMIN may create all four). */
export type CreatableRole = 'ADMIN' | 'OPERATIONS' | 'PACKING_STAFF' | 'RIDER';

/** GET /admin/staff row. ADMIN rows come back with read_only: true. */
export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  /** null for Admin and Inventory accounts: they have no phone (backend migration 028). */
  phone: string | null;
  role: CreatableRole;
  has_password: boolean;
  disabled: boolean;
  read_only: boolean;
  created_at: string;
  /** "Can deliver" (staff riders): the account's rider profile, null when none. */
  rider?: StaffRider | null;
}

/** An account's rider profile: a Rider's own, or an Operations/Admin "Can deliver" one. */
export interface StaffRider {
  id: string;
  is_active: boolean;
  vehicle_type: string;
  vehicle_registration_number: string;
  emergency_contact_phone?: string | null;
}

export type VehicleType = 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'THREE_WHEELER' | 'CAR';

export interface StaffRiderInput {
  can_deliver: boolean;
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
}

export interface CreateStaffInput {
  full_name: string;
  email: string;
  password: string;
  role: CreatableRole;
  /** Operations and Rider accounts only (required for them); Admin and Inventory have none. */
  phone?: string;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface UpdateStaffInput {
  full_name?: string;
  role?: StaffRole;
  /** Needed when moving an account to Operations (400 PHONE_REQUIRED otherwise). */
  phone?: string;
  password?: string;
  disabled?: boolean;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface AuthUser {
  id: string;
  /** null for accounts without a phone (Admin, Inventory: backend migration 028). */
  phone: string | null;
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
  /** Live, non-deleted products in this category (GET /admin/categories). */
  product_count?: number;
  /** The Home tile group it sits in (null = unassigned). */
  group_id?: string | null;
  group_sort_order?: number;
  /** The category this one sits inside (null = top level). One level only. */
  parent_id?: string | null;
  /**
   * Category offer (owner, 2026-10-09; migration 033): % off every product in
   * this category and its sub-categories, with an optional end (ISO).
   * `offer_active` is true only while it runs right now.
   */
  offer_percent?: number | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
}

/**
 * Arrange (owner, 2026-10-10): one row of a category's "Arrange products"
 * list (`GET /admin/categories/:id/product-order`), in the order customers
 * see them. `display_order` null = not arranged (A-Z after the arranged).
 */
export interface ArrangeProduct {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x: number;
  image_focal_y: number;
  selling_price: number;
  is_active: boolean;
  is_available: boolean;
  display_order: number | null;
}

export interface CategoryProductOrder {
  category: { id: string; name: string; parent_id: string | null };
  products: ArrangeProduct[];
}

/** A category as listed inside a group (GET /admin/category-groups). */
export interface GroupCategory {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
  group_id: string | null;
  /** The group's stored list position; kept for compatibility, no longer the
   * display order (owner, 2026-10-10). */
  group_sort_order: number;
  /** Arrange order (Categories -> Arrange), which the group lists by. Absent on an older API. */
  display_order?: number;
}

/** A titled row of category tiles on the customer Home, e.g. "Grocery & Kitchen". */
export interface CategoryGroup {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** In Arrange order (display_order, name; owner, 2026-10-10). */
  categories: GroupCategory[];
}

/** GET /admin/category-groups: groups in order, plus live categories in no group. */
export interface CategoryGroupsOverview {
  groups: CategoryGroup[];
  unassigned: GroupCategory[];
}

/** DELETE /admin/category-groups/:id - its categories become unassigned. */
export interface CategoryGroupDeleteResult {
  group_id: string;
  released_category_count: number;
}

/** DELETE /admin/products/:id - HARD when never ordered, SOFT (hidden) otherwise. */
export interface ProductDeleteResult {
  product_id: string;
  mode: 'HARD' | 'SOFT';
}

/** DELETE /admin/categories/:id */
export interface CategoryDeleteResult {
  category_id: string;
  moved_product_count: number;
  mode: 'HARD' | 'SOFT';
}

/** GET/PATCH /admin/settings/delivery-fee */
export interface DeliveryFeeSetting {
  fee_lkr: number;
  updated_at: string | null;
}

/** GET/PATCH /admin/settings/checkout - checkout switches (owner, 2026-10-08). */
export interface CheckoutSettings {
  coupons_enabled: boolean;
  /**
   * Free deliveries for every customer (owner, 2026-10-09): `count` free
   * deliveries per customer, counting only orders placed on or after `since`
   * (ISO). PATCH may omit `since` to keep the stored one.
   */
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  /** The customer app shows "Save LKR X" on offers (owner, 2026-10-10).
   * Optional: a backend from before the switch leaves it out (= off). */
  show_offer_savings?: boolean;
  updated_at: string | null;
}

/** One spreadsheet row sent to POST /admin/products/import. */
export interface ImportRow {
  row?: number;
  name: string;
  category: string;
  unit: string;
  pack_size?: string | null;
  cost_price: number;
  selling_price?: number | null;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  tracked?: 'yes' | 'no' | boolean | null;
  opening_stock?: number | null;
  image_url?: string | null;
}

export type ImportStatus = 'created' | 'updated' | 'skipped' | 'error';

export interface ImportResultRow {
  row: number;
  sku: string | null;
  status: ImportStatus;
  product_id?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface ImportResponse {
  dry_run: boolean;
  summary: { created: number; updated: number; skipped: number; errors: number };
  results: ImportResultRow[];
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
  /**
   * Offer price (owner, 2026-10-09): a reduced price customers pay, as
   * stored, with an optional end (ISO). `offer_active` is true only while it
   * applies now (set, not ended, below the selling price).
   */
  offer_price?: number | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
  /** The category offer running on this product (own category or parent; owner, 2026-10-09). */
  category_offer_percent?: number | null;
  category_offer_ends_at?: string | null;
  /** What a customer pays right now: the lower of the product and category offers. */
  customer_price?: number;
  is_available: boolean;
  is_active: boolean;
  updated_at?: string;
}

/** Why a combo is not shown to customers (owner, 2026-10-09). */
export type ComboNotLiveReason = 'INACTIVE' | 'ENDED' | 'ITEM_INACTIVE' | 'NOT_CHEAPER';

/** One product in a combo pack, per pack (GET /admin/combos). */
export interface ComboItem {
  product_id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  unit: string | null;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x?: number;
  image_focal_y?: number;
  quantity: number;
  /** The product's regular price. */
  selling_price: number;
  /** What one unit costs on its own today (offers included). */
  unit_price: number;
  is_active: boolean;
  is_available: boolean;
  in_stock: boolean;
  /** Tracked units free to sell; null = untracked. */
  stock_available: number | null;
}

/** A combo pack as staff see it (owner, 2026-10-09; migration 033). */
export interface Combo {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at: string | null;
  display_order: number;
  created_at?: string;
  updated_at?: string;
  items: ComboItem[];
  /** What one pack's items cost on their own today. */
  items_total: number;
  /** items_total - price, never below 0. */
  saving: number;
  /** Shown to customers and orderable. */
  is_live: boolean;
  /** Live and every item in stock. */
  is_available: boolean;
  not_live_reason: ComboNotLiveReason | null;
}

/** POST /admin/combos; PATCH takes any subset (items replaces the whole list). */
export interface ComboInput {
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at?: string | null;
  display_order: number;
  items: Array<{ product_id: string; quantity: number }>;
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
  /**
   * ARTWORK (backend promotion.schema.ts): a finished banner in
   * background_image_url, drawn full-bleed with no scrim, headline or
   * subtitle. The title is still required - it is the slide's accessibility
   * label in the customer app.
   */
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  /** Crop anchor for the background image, 0-100 (migration 009); 50 = centre. */
  background_focal_x?: number;
  background_focal_y?: number;
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
  /** Slot end (migration 036); null on older orders - show just the start (owner, 2026-10-10). */
  scheduled_until?: string | null;
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
  /**
   * Admin detail only. Read to tell a substitution with a recorded cost from
   * one without (what blocks packing); never rendered.
   */
  actual_unit_cost?: number | string | null;
  product_id?: string | null;
  /** The order combo line this item belongs to; null for a loose item (owner, 2026-10-09). */
  order_combo_id?: string | null;
}

/** One combo pack line of an order; its items point at it by order_combo_id. */
export interface OrderCombo {
  id: string;
  order_id: string;
  combo_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  /** One pack's items at their own prices. */
  items_regular_total: number;
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
  subtotal_amount: number;
  delivery_fee: number;
  /** Coupon discount (backend migration 018); total = subtotal + delivery fee - discount. */
  discount_amount?: number;
  coupon_code?: string | null;
  /** Birthday gift (owner, 2026-10-09): when > 0 it is the whole discount_amount and coupon_code is null. */
  birthday_discount_amount?: number;
  total_amount: number;
  placed_at: string;
  scheduled_for: string | null;
  /** Slot end (migration 036); null on older orders (owner, 2026-10-10). */
  scheduled_until?: string | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  /** Migration 024: a second number from the address; null when none was given. */
  delivery_alternate_phone?: string | null;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_instructions: string | null;
  cancellation_reason: string | null;
  items: OrderItemRow[];
  /** Combo pack lines (owner, 2026-10-09); absent on older API responses. */
  combos?: OrderCombo[];
  history: OrderHistoryRow[];
  delivery: { id: string; assignment_status: string; rider_name?: string | null } | null;
}

/** GET /admin/riders */
export interface RiderOption {
  id: string;
  full_name: string | null;
  /** null for an Admin who can deliver: admins have no phone (backend migration 028). */
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string;
  open_deliveries: number;
  /** False only in GET /admin/riders?include_inactive=true: the rider can no longer deliver. */
  is_active?: boolean;
  /** Rider pay (backend migration 032, owner 2026-10-09). */
  pay_type?: RiderPayType;
  /** The rider's own commission %; null = the store default. */
  commission_percent?: number | null;
  /** The rider's own pay model; null = follows the store default (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

/**
 * Rider pay (owner, 2026-10-09): a COMPANY rider is salaried - no
 * per-delivery commission, Blynk keeps the delivery charge. A COMMISSION
 * rider earns a % of the STANDARD delivery fee (store default, or their own
 * override) and keeps that share out of the COD cash they collect.
 */
export type RiderPayType = 'COMPANY' | 'COMMISSION';

// ------------------------------------------------- rider pay controls
// Rider pay controls (owner, 2026-10-10): "give the option in ops and admin
// to control the rider app charges" - fixed / % / distance pay, bonuses and
// incentives, deductions and extra pay.

/** PERCENT: % of the standard delivery fee; FIXED: LKR per delivery; DISTANCE: base + LKR per km. */
export type PayModel = 'PERCENT' | 'FIXED' | 'DISTANCE';
/** +LKR per delivery, or +% of the delivery's base earning. */
export type BoostMode = 'FIXED' | 'PERCENT';
export type BonusKind = 'PEAK_BOOST' | 'RAIN_BOOST' | 'LONG_DISTANCE' | 'DAILY_TARGET';
export type AdjustmentReason = 'CASH_SHORT' | 'DAMAGED_ITEM' | 'LATE' | 'BONUS' | 'OTHER';

/** A complete pay model (store default or a rider's effective one). */
export interface PayParams {
  model: PayModel;
  percent: number;
  fixed_lkr: number;
  base_lkr: number;
  per_km_lkr: number;
  /** Optional floor per delivery (any model); null = no floor. */
  min_lkr: number | null;
}

/** days 1=Mon..7=Sun; "HH:MM", start < end, end may be "24:00". */
export interface PeakWindow {
  days: number[];
  start: string;
  end: string;
}

export interface PeakBoostRule {
  enabled: boolean;
  mode: BoostMode;
  amount: number;
  windows: PeakWindow[];
}

export interface DailyTargetTier {
  deliveries: number;
  amount_lkr: number;
}

export interface DailyTargetRule {
  enabled: boolean;
  tiers: DailyTargetTier[];
}

export interface LongDistanceRule {
  enabled: boolean;
  over_km: number;
  amount_lkr: number;
}

export interface BonusRules {
  /** false: automatic bonuses are for COMMISSION riders only; true: COMPANY riders get them too. */
  company_riders: boolean;
  peak: PeakBoostRule;
  daily_target: DailyTargetRule;
  long_distance: LongDistanceRule;
}

export interface RainBoost {
  on: boolean;
  mode: BoostMode;
  amount: number;
  /** ISO; the boost stops by itself at this time. */
  auto_off_at: string | null;
  turned_on_at: string | null;
  /** on && (auto_off_at null || now < auto_off_at) */
  active: boolean;
}

/** GET /admin/settings/rider-pay (and every PATCH under it). */
export interface RiderPaySettings {
  /** default_model.percent is the same value as GET /admin/settings/rider-commission. */
  default_model: PayParams;
  bonus_rules: BonusRules;
  rain_boost: RainBoost;
}

/** PATCH /admin/settings/rider-pay/model - omitted = keep. */
export interface RiderPayModelInput {
  model: PayModel;
  percent?: number;
  fixed_lkr?: number;
  base_lkr?: number;
  per_km_lkr?: number;
  min_lkr?: number | null;
}

/** PATCH /admin/settings/rider-pay/bonuses - each section a complete object. */
export type RiderPayBonusesInput = Partial<BonusRules>;

/** PATCH /admin/settings/rider-pay/rain-boost */
export interface RainBoostInput {
  on: boolean;
  mode?: BoostMode;
  amount?: number;
  auto_off_at?: string | null;
}

/** GET/PATCH /admin/riders/:id/pay */
export interface RiderPay {
  rider_id: string;
  pay_type: RiderPayType;
  /** The rider's own override, or null (store default). */
  commission_percent: number | null;
  /** The % in force: a number for COMMISSION, null for COMPANY. */
  effective_percent: number | null;
  default_percent: number;
  /** Rider's own model; null = follows the store default model (owner, 2026-10-10). */
  pay_model?: PayModel | null;
  /** null each = the store default value. */
  own?: { fixed_lkr: number | null; base_lkr: number | null; per_km_lkr: number | null; min_lkr: number | null };
  /** What a new delivery pays this rider now; null for COMPANY. */
  effective?: PayParams | null;
  default_model?: PayParams;
}

/** Body of PATCH /admin/riders/:id/pay and (optionally) the approve call. */
export interface RiderPayInput {
  pay_type: RiderPayType;
  commission_percent?: number | null;
  /** (owner, 2026-10-10) null = follows the store default model. */
  pay_model?: PayModel | null;
  fixed_lkr?: number | null;
  base_lkr?: number | null;
  per_km_lkr?: number | null;
  min_lkr?: number | null;
}

/** A deduction (negative) or extra pay (positive) for a rider (owner, 2026-10-10). */
export interface RiderAdjustment {
  id: string;
  rider_id: string;
  rider_name: string | null;
  /** Signed: negative = deduction, positive = extra pay; never 0. */
  amount_lkr: number;
  reason: AdjustmentReason;
  note: string | null;
  /** YYYY-MM-DD (Asia/Colombo) - the day's cash it settles against. */
  adjustment_date: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /admin/riders/:id/adjustments; PATCH takes any of these. */
export interface RiderAdjustmentInput {
  amount_lkr: number;
  reason: AdjustmentReason;
  note?: string | null;
  adjustment_date?: string;
}

/** GET/PATCH /admin/settings/rider-commission */
export interface RiderCommissionSetting {
  default_percent: number;
  updated_at: string | null;
}

/** Rider trips (owner, 2026-10-10): how many orders one rider may carry at
 * once (1 = no trips) and the max straight-line km between their drop-offs
 * before staff must confirm. GET|PATCH /admin/settings/rider-trips. */
export interface RiderTripsSetting {
  max_active_deliveries: number;
  max_dropoff_distance_km: number;
  updated_at: string | null;
}

/** Doctors need sign-in (owner, 2026-10-10): when on (the default), a guest
 * must log in or create an account with their phone number before the
 * customer app shows clinics and doctors. GET|PATCH
 * /admin/settings/doctors-access. */
export interface DoctorsAccessSetting {
  require_sign_in: boolean;
  updated_at: string | null;
}

/** GET/PATCH /admin/settings/birthday-offer - X% off ONE order in the
 * customer's birthday week, plus a birthday SMS (owner, 2026-10-09). */
export interface BirthdayOfferSetting {
  enabled: boolean;
  percent: number;
  sms_enabled: boolean;
  /** May contain {percent}. */
  sms_text: string;
  /** sms_text with {percent} filled in - what customers receive. */
  sms_preview: string;
  sms_parts: number;
  /** Days either side of the birthday (3). */
  window_days: number;
  updated_at: string | null;
}

export interface BirthdayOfferInput {
  enabled?: boolean;
  percent?: number;
  sms_enabled?: boolean;
  sms_text?: string;
}

/** One row of GET /admin/birthdays. */
export interface BirthdayCustomer {
  id: string;
  full_name: string | null;
  phone: string;
  date_of_birth: string;
  /** This occurrence of the birthday, YYYY-MM-DD. */
  birthday: string;
  /** Negative: the birthday was a few days ago, still in its gift week. */
  days_until: number;
  turning: number;
  favourite_categories: { id: string; name: string }[];
  favourites_note: string | null;
  offer_used: boolean;
}

export interface BirthdaysResult {
  today: string;
  customers: BirthdayCustomer[];
}

export type RiderEarningsRange = 'today' | 'this_week' | 'custom';

export interface RiderEarningsFigures {
  deliveries: number;
  /** Standard-fee basis - what the commission is a % of. */
  delivery_charges: number;
  /** What customers actually paid (0 on free deliveries). */
  customer_delivery_fees: number;
  rider_share: number;
  blynk_delivery_share: number;
  cash_collected: number;
  cash_kept: number;
  cash_to_hand_in: number;
  product_sales: number;
  product_cost: number;
  product_margin: number;
  coupon_discount: number;
  // Rider pay controls (owner, 2026-10-10). Optional: an older API lacks them.
  /** Sum of each delivery's base pay (model + floor). */
  base_earnings?: number;
  /** Peak + rain + long-distance bonuses on those deliveries. */
  delivery_bonuses?: number;
  /** Daily-target bonuses. */
  day_bonuses?: number;
  /** Positive adjustments. */
  additions?: number;
  /** Negative adjustments, as a positive number. */
  deductions?: number;
  /** additions - deductions (signed). */
  adjustments?: number;
  /** base_earnings + delivery_bonuses + day_bonuses + adjustments */
  total_earnings?: number;
  bonus_breakdown?: Record<BonusKind, number>;
  /** What Blynk still owes (earnings + extras the day's cash could not cover). */
  payable_to_rider?: number;
}

export interface RiderEarningsRow extends RiderEarningsFigures {
  rider_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pay_type: RiderPayType;
  commission_percent: number | null;
  effective_percent: number | null;
  /** Effective model now; null for COMPANY (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

/** GET /admin/reports/rider-earnings */
export interface RiderEarningsReport {
  range: { from: string; to: string; timezone: string };
  default_percent: number;
  riders: RiderEarningsRow[];
  totals: RiderEarningsFigures;
  /** The range's pay adjustments, newest first (owner, 2026-10-10). */
  adjustments?: RiderAdjustment[];
  /** The store default pay model (owner, 2026-10-10). */
  default_model?: PayParams;
}

/** One order a rider already carries (GET /admin/riders/suggestions). */
export interface TripStop {
  order_id: string;
  order_number: string;
  assignment_status: string;
  /** Straight line between that drop-off and this order's; null when a pin is missing. */
  dropoff_distance_km: number | null;
}

/**
 * GET /admin/riders/suggestions?order_id= (backend rider trips, 2026-09-30):
 * the RiderOption fields plus load, distance to the store and trip. Best
 * first; one (or none) is `suggested`. Never a rider's coordinates.
 */
export interface RiderSuggestion extends RiderOption {
  at_capacity: boolean;
  last_seen_at: string | null;
  location_known: boolean;
  distance_km: number | null;
  trip: TripStop[];
  trip_within_distance: boolean;
  suggested: boolean;
}

export interface RiderSuggestions {
  order_id: string;
  rules: { max_active_deliveries: number; max_dropoff_distance_km: number; location_fresh_minutes: number };
  riders: RiderSuggestion[];
}

// ------------------------------------------------------------ feedback
export type FeedbackCategory = 'APP' | 'DELIVERY' | 'PRODUCTS' | 'OTHER';
export type FeedbackStatus = 'NEW' | 'READ';

/** A row of GET /admin/feedback (backend migration 013). */
export interface FeedbackItem {
  id: string;
  rating: number | null;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  created_at: string;
  user_id: string;
  full_name: string | null;
  phone: string;
}

export interface FeedbackPage {
  feedback: FeedbackItem[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ------------------------------------------------------------- coupons
/** Backend migration 018. ADMIN only. */
export type CouponType = 'FIXED' | 'PERCENT' | 'FREE_DELIVERY';

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: CouponType;
  discount_value: number;
  max_discount: number | null;
  min_subtotal: number | null;
  first_order_only: boolean;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  per_customer_limit: number;
  is_active: boolean;
  usage_count: number;
  created_at: string;
}

export interface CouponInput {
  code?: string;
  description?: string | null;
  discount_type: CouponType;
  discount_value?: number;
  max_discount?: number | null;
  min_subtotal?: number | null;
  first_order_only?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  per_customer_limit?: number;
  is_active?: boolean;
}

// --------------------------------------------------------------- sales
export type SalesRange = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';

export interface SalesProduct {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
}

/** GET /admin/reports/sales. */
export interface SalesReport {
  range: { from: string; to: string; timezone: string };
  order_count: number;
  delivered_count: number;
  delivered_revenue: number;
  average_basket: number;
  cancelled_count: number;
  discount_given: number;
  delivery_fees: number;
  top_by_quantity: SalesProduct[];
  top_by_revenue: SalesProduct[];
  orders_by_hour: { hour: number; orders: number }[];
}

// ----------------------------------------------------------- customers
export type CustomerSort = 'recent' | 'spend' | 'orders' | 'name';

export interface CustomerRow {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
  orders_count: number;
  delivered_count: number;
  delivered_spend: number;
  last_order_at: string | null;
  /** Language the customer picked in the app for SMS; null = never picked. */
  sms_language: SmsLanguage | null;
  /** false = the customer turned "Offers by SMS" off. */
  sms_offers: boolean;
  /** Optional profile (owner, 2026-10-09): YYYY-MM-DD, a calendar day. */
  date_of_birth?: string | null;
}

/** GET /admin/customers/export: every customer, by name (ADMIN only). */
export interface CustomerExportRow {
  full_name: string | null;
  phone: string;
  is_active: boolean;
  created_at: string;
  orders_count: number;
  delivered_spend: number;
  last_order_at: string | null;
  sms_language: SmsLanguage | null;
  sms_offers: boolean;
}

export interface CustomerOrderRow {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_status: string;
  subtotal_amount: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  coupon_code: string | null;
  /** Birthday gift (owner, 2026-10-09); 0 / absent when none. */
  birthday_discount_amount?: number;
  placed_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  item_count: number;
}

export interface CustomerDetail {
  customer: CustomerRow & {
    last_login_at: string | null;
    /** Optional profile the customer saves in the app (owner, 2026-10-09). */
    favourite_categories?: { id: string; name: string }[];
    favourites_note?: string | null;
  };
  orders: CustomerOrderRow[];
  pagination: Paginated<unknown>['pagination'];
}

// ---------------------------------------------------------------- cash
/** Backend migration 019. ADMIN and OPERATIONS. */
export interface CashHandin {
  id: string;
  rider_id: string;
  rider_name: string | null;
  amount: number;
  handin_date: string;
  note: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

export type ReconciliationStatus = 'SHORT' | 'OVER' | 'BALANCED';

export interface RiderReconciliation {
  rider_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  deliveries: number;
  handins: number;
  collected: number;
  handed_in: number;
  /** handed_in - expected_handin since rider pay (negative = short). */
  difference: number;
  status: ReconciliationStatus;
  /** Rider pay (owner, 2026-10-09). */
  pay_type?: RiderPayType;
  /** Commission share the rider keeps out of the cash (0 for a company rider). */
  kept_share?: number;
  /** max(0, collected - kept_share - day_bonuses - adjustments): what the rider should hand in. */
  expected_handin?: number;
  /** Daily-target bonuses kept from the day's cash (owner, 2026-10-10). */
  day_bonuses?: number;
  /** Signed: extra pay (+) kept from the cash, deductions (-) added to the hand-in. */
  adjustments?: number;
  /** What the day's cash could not cover: Blynk owes the rider this. */
  payable_to_rider?: number;
}

export interface CashReconciliation {
  date: string;
  timezone: string;
  riders: RiderReconciliation[];
  totals: {
    collected: number;
    handed_in: number;
    difference: number;
    status: ReconciliationStatus;
    kept_share?: number;
    expected_handin?: number;
    day_bonuses?: number;
    adjustments?: number;
    payable_to_rider?: number;
  };
}

// ------------------------------------------------------------ sms offers
/** Backend migration 027. ADMIN and OPERATIONS. */
export type SmsLanguage = 'si' | 'ta' | 'en';

export type SmsOfferAudience = 'ALL' | 'ORDERED_30D' | 'ORDERED_90D' | 'NEVER_ORDERED';

export interface SmsOfferInput {
  audience: SmsOfferAudience;
  fallback_language: SmsLanguage;
  messages: Partial<Record<SmsLanguage, string>>;
}

/** POST /admin/sms-offers/estimate. */
export interface SmsOfferEstimate {
  audience: SmsOfferAudience;
  recipients: number;
  /** Recipients per language, after the fallback. */
  by_language: Record<SmsLanguage, number>;
  /** Customers who never picked a language (they get the fallback). */
  without_language: number;
  opted_out: number;
  /** SMS parts one recipient costs, opt-out line included. */
  parts_per_sms: Partial<Record<SmsLanguage, number>>;
  sms_parts_total: number;
  /** Languages with recipients but no text (only ever enabled ones). */
  missing_languages: SmsLanguage[];
  /** Languages offers are written in right now (backend SMS_OFFER_LANGUAGES); ['en'] at launch. */
  languages: SmsLanguage[];
}

export interface SmsOfferSent {
  id: string;
  created_at: string;
  recipients: number;
  sms_parts_total: number;
}

export interface SmsOfferTestResult {
  /** The number the test went to, masked. */
  sent_to: string;
  sms_parts: number;
}

export interface SmsOffer {
  id: string;
  audience: SmsOfferAudience;
  fallback_language: SmsLanguage;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  recipient_count: number;
  sms_parts_total: number;
  created_at: string;
  sent_by_name: string | null;
  sent_by_role: string | null;
}

// ---------------------------------------------------------------------------
// Rider applications (migration 029): riders apply in the Rider app; Admin or
// Operations approve or reject them here.
export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RiderApplication {
  /** riders.id */
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
  approval_status: RiderApprovalStatus;
  applied_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  rejection_reason: string | null;
  /** Rider pay (owner, 2026-10-09); meaningful once approved. */
  pay_type?: RiderPayType;
  /** Own commission %, null = the store default. */
  commission_percent?: number | null;
  /** Own pay model; null = follows the store default (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

export interface RiderApplicationPage {
  applications: RiderApplication[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ---------------------------------------------------------------------------
// Dental doctors (owner, 2026-10-09). The same /admin/dental/doctors
// endpoints the Operations app uses (ADMIN or OPERATIONS). A doctor's
// specialty is free text since migration 030 (2-64 characters).
export type DentalSpecialty = string;

/** Quick picks in the Add/Edit doctor form - the specialty can be any text. */
export const DENTAL_SPECIALTY_SUGGESTIONS = [
  // Any kind of doctor, not only dentists (owner, 2026-10-10: "we can add
  // other doctors also"). Staff can still type any specialty.
  'General physician',
  'Pediatrician',
  'Gynecologist',
  'Dentist',
  'Eye specialist',
  'ENT specialist',
  'Skin specialist',
  'Cardiologist',
] as const;

export interface DentalDoctor {
  id: string;
  full_name: string;
  specialty: DentalSpecialty;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Visible ratings (migration 023): the list endpoint sends them,
   * create/update responses do not. */
  rating_average?: number | null;
  rating_count?: number;
}

export interface DentalDoctorInput {
  full_name?: string;
  specialty?: DentalSpecialty;
  photo_url?: string | null;
  bio?: string | null;
  is_active?: boolean;
}

// ------------------------------------------------------- store schedule
/** Store schedule (owner, 2026-10-10: "the timing will be decided by ops
 * and admin"). All times Asia/Colombo; "HH:MM" is 24h on 15-minute steps. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  closed: boolean;
  open: string;
  close: string;
}

export interface StoreHours {
  same_every_day: boolean;
  days: Record<DayKey, DayHours>;
  updated_at: string | null;
}

export interface StoreClosure {
  closed: boolean;
  reason: string | null;
  reopens_at: string | null;
  closed_at: string | null;
  updated_at: string | null;
}

export interface StoreHoliday {
  /** YYYY-MM-DD */
  date: string;
  reason: string | null;
}

export interface DeliverySlotSettings {
  enabled: boolean;
  slot_minutes: 30 | 60 | 120;
  /** 1 = today and tomorrow. */
  days_ahead: 1 | 2 | 3;
  max_orders_per_slot: number;
  min_lead_minutes: number;
}

export type ClosedKind = 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';

export interface StoreStatus {
  is_open_now: boolean;
  closed_kind: ClosedKind;
  closed_reason: string | null;
  reopens_at: string | null;
  next_open_at: string | null;
  today_hours: { open: string; close: string } | null;
}

/** GET /admin/settings/store-schedule, and what every schedule PATCH returns. */
export interface StoreSchedule {
  hours: StoreHours;
  closure: StoreClosure;
  holidays: StoreHoliday[];
  delivery_slots: DeliverySlotSettings & { updated_at: string | null };
  /**
   * (owner, 2026-10-10) "Send offer/birthday texts on closed days". true
   * (default): offer, test and birthday SMS still go out on a closed weekday
   * (8 AM - 9 PM), a holiday or while closed now; false: only while the store
   * is open. Missing from a server older than this = true.
   */
  sms?: StoreSmsSettings & { updated_at: string | null };
  status: StoreStatus;
}

export interface StoreSmsSettings {
  sms_on_closed_days: boolean;
}

export type StoreHoursInput =
  | { same_every_day: true; open: string; close: string }
  | { same_every_day: false; days: Record<DayKey, DayHours> };

export type StoreClosureInput = { closed: true; reason: string; reopens_at?: string | null } | { closed: false };
