import { Generated, ColumnType } from 'kysely';

/** OPERATIONS added by migration 014 (Operations-app-only staff). */
export type UserRole = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN' | 'OPERATIONS';
export type InventoryTrackingMode = 'UNTRACKED' | 'TRACKED';
export type InventoryAdjustmentType =
  | 'PURCHASE_RESTOCK'
  | 'ORDER_RESERVATION'
  | 'ORDER_FULFILLMENT'
  | 'ORDER_CANCELLATION_RESTORE'
  | 'DAMAGE_WRITE_OFF'
  | 'INVENTORY_AUDIT_ADJUSTMENT';

export type OrderStatus =
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
}

/** Migration 027: the languages an offer SMS can be written in. */
export type SmsLanguage = 'si' | 'ta' | 'en';

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
}

export interface InventoryTable {
  id: Generated<string>;
  dark_store_id: string;
  product_id: string;
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
  total_amount: ColumnType<number, number | string, number | string>;
  /** Migration 018: coupon discount snapshot; total = subtotal + delivery_fee - discount_amount. */
  discount_amount: ColumnType<number, number | string | undefined, number | string>;
  coupon_code: ColumnType<string | null, string | null | undefined, string | null>;
  scheduled_for: Date | null;
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
  effective_markup_percent: ColumnType<number, number | string, number | string>;
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

export interface Database {
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
  promotions: PromotionsTable;
  inventory: InventoryTable;
  inventory_adjustments: InventoryAdjustmentsTable;
  suppliers: SuppliersTable;
  sourcing_records: SourcingRecordsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_status_history: OrderStatusHistoryTable;
  payments: PaymentsTable;
  riders: RidersTable;
  deliveries: DeliveriesTable;
  notifications: NotificationsTable;
  audit_logs: AuditLogsTable;
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
  cash_handins: CashHandinsTable;
  device_tokens: DeviceTokensTable;
  stock_alerts: StockAlertsTable;
  v_product_catalog: ProductCatalogView;
}
