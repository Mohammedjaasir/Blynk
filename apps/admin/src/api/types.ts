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
}

/** A category as listed inside a group (GET /admin/category-groups). */
export interface GroupCategory {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
  group_id: string | null;
  group_sort_order: number;
}

/** A titled row of category tiles on the customer Home, e.g. "Grocery & Kitchen". */
export interface CategoryGroup {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Ordered by group_sort_order. */
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
  total_amount: number;
  placed_at: string;
  scheduled_for: string | null;
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
  placed_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  item_count: number;
}

export interface CustomerDetail {
  customer: CustomerRow & { last_login_at: string | null };
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
  difference: number;
  status: ReconciliationStatus;
}

export interface CashReconciliation {
  date: string;
  timezone: string;
  riders: RiderReconciliation[];
  totals: { collected: number; handed_in: number; difference: number; status: ReconciliationStatus };
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
  'General dentist',
  'Orthodontist',
  'Periodontist',
  'Endodontist',
  'Oral surgeon',
  'Pediatric dentist',
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
