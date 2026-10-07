/**
 * Shapes returned by the Blynk API - mirrors of the backend DTOs. Extend
 * this file the same way `resources.ts` is extended: this task (F1) adds
 * only the auth-related shapes below; each later task appends its own
 * domain's types here (or in a co-located block with a comment banner like
 * this one), never guessing a field that isn't in the real backend
 * response/request shape (per common.md rule 7).
 */

/** The real backend enum (`backend/api/src/database/types.ts:3`) - exactly
 * four values, nothing invented or copied from another app's stale list. */
/** OPERATIONS: Operations-app-only staff (backend migration 014). */
export type UserRole = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN' | 'OPERATIONS';

export interface AuthUser {
  id: string;
  /** null for email+password-only accounts (Admin, Inventory). */
  phone: string | null;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

// ------------------------------------------------------------------ orders
// Task F2 (Home). `orders.order_status` - the existing enum, nothing added
// (mirrors apps/admin/src/lib/orders.ts's own `OrderStatus`).
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
 * A row of `GET /admin/orders`. The real endpoint (Admin's `BoardOrder`,
 * apps/admin/src/api/types.ts) returns many more fields; Home only ever
 * reads list length for a count, so only `id` is kept here (common.md rule
 * 13 - no drive-by expansion of a DTO this task doesn't render). A later
 * Orders-board task (F3) should define the full row shape itself when it
 * actually displays one.
 */
export interface HomeOrder {
  id: string;
}

// Task F3 (Orders board/detail). The fields `GET /admin/orders` actually
// returns per row (backend/api/src/modules/orders/order.repository.ts
// `findAdminOrders`) - mirrors Admin's own `BoardOrder`
// (apps/admin/src/api/types.ts) exactly, field for field.
export interface ItemsSummary {
  total: number;
  pending: number;
  sourced: number;
  packed: number;
  unavailable: number;
  substituted: number;
  /**
   * Substituted items still without the cost packing requires - counted by
   * the API with the lifecycle's own rule (backend isUncostedSubstitution).
   * Missing from an older API: every substitution is then treated as uncosted.
   */
  uncosted_substitutions?: number;
}

export interface ActiveDelivery {
  id: string;
  assignment_status: string;
  rider_id: string;
  rider_name: string | null;
}

/** A row of `GET /admin/orders` (the live board/closed-since query). */
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
  /** The product's unit at order time ("1 L", "500 g"); read by the packing slip. */
  unit_snapshot?: string | null;
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

/**
 * `GET /admin/orders/:id`. Mirrors Admin's own `OrderDetail`, with one
 * deliberate widening: `delivery.rider_id` is kept (Admin's own type omits
 * it - its panel always also has the separately-loaded `BoardOrder` row for
 * the same order, which already carries `active_delivery.rider_id`).
 * Operations' `OrderDetail` page is a standalone, directly-linkable route
 * (no guaranteed board data in memory - see `lib/orders.ts`'s
 * `boardOrderLikeFromDetail`), so it derives its own action-rule input from
 * this response alone; `rider_id` is a real column already returned by the
 * backend (`delivery.columns.ts`'s `DELIVERY_PUBLIC_COLUMNS`), not invented.
 */
export interface OrderDetail {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_method: 'COD' | 'ONLINE';
  payment_status: string;
  /** Bill lines (backend migration 018): total = subtotal + delivery_fee - discount_amount. */
  subtotal_amount?: number;
  delivery_fee?: number;
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
  /** The customer's own note on the order (packing slip). */
  customer_notes?: string | null;
  delivery_postal_code?: string | null;
  cancellation_reason: string | null;
  items: OrderItemRow[];
  history: OrderHistoryRow[];
  delivery: { id: string; rider_id: string; assignment_status: string; rider_name?: string | null } | null;
}

// ------------------------------------------------------------------ riders
/** A row of `GET /admin/riders`. Home only reads list length for a count;
 * see the `HomeOrder` comment above for why this is intentionally minimal -
 * F7 (rider list) should define the full shape (mirrors Admin's
 * `RiderOption`) when it renders one. */
export interface HomeRider {
  id: string;
}

/**
 * Task F3: the assign-rider dialog needs more than a count, so
 * `resources.ts`'s `riders.listActive()` was widened from `HomeRider[]` to
 * this - the full row `GET /admin/riders` already returns (mirrors Admin's
 * own `RiderOption` exactly). `HomeRider` is left in place, unchanged and
 * still used nowhere else that needs more than `.length`; `RiderOption` is a
 * structural superset of it, so Home's own typing is unaffected.
 */
export interface RiderOption {
  id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string;
  open_deliveries: number;
  /** False only in `GET /admin/riders?include_inactive=true`: the rider can no longer deliver. */
  is_active?: boolean;
}

/** One order a rider already carries (`GET /admin/riders/suggestions`). */
export interface TripStop {
  order_id: string;
  order_number: string;
  assignment_status: AssignmentStatus;
  /** Straight line between that drop-off and this order's; null when a pin is missing. */
  dropoff_distance_km: number | null;
}

/**
 * A row of `GET /admin/riders/suggestions?order_id=` (backend rider trips,
 * 2026-09-30): the `RiderOption` fields plus how busy and how far the rider
 * is. Best first; exactly one (or none) is `suggested`. Never coordinates.
 */
export interface RiderSuggestion extends RiderOption {
  at_capacity: boolean;
  last_seen_at: string | null;
  /** The rider's last GPS point is under `location_fresh_minutes` old. */
  location_known: boolean;
  /** Straight line from that point to the store, when location_known. */
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

/** `deliveries.assignment_status` - the existing enum, nothing added
 * (mirrors apps/rider/src/api/types.ts's own `AssignmentStatus`). */
export type AssignmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'REJECTED';

/**
 * A row of `GET /riders/deliveries` for the signed-in operator's own linked
 * rider profile - identity is always resolved server-side from the bearer
 * token, never sent by this client (common.md rule 4). The real endpoint
 * returns more fields (mirrors Rider's `DeliverySummary`,
 * apps/rider/src/api/types.ts); only the ones Home's active-delivery card
 * actually renders are kept here, plus `order_status`/`payment_method`/
 * `payment_status`/`total_amount` (design-audit I5) - the API already
 * returns these, they just weren't typed - so Home can run the same
 * `statusLabel()` rules `lib/delivery.ts` gives Queue/Detail instead of
 * printing the raw `assignment_status` enum.
 */
export interface MyDelivery {
  delivery_id: string;
  order_number: string;
  assignment_status: AssignmentStatus;
  order_status: OrderStatus;
  payment_method: 'COD' | 'ONLINE';
  payment_status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  total_amount: number;
  delivery_recipient_name: string;
  delivery_address_line1: string;
  delivery_city: string;
}

// ---------------------------------------------------------------- delivery
// Task F4 (Delivery Mode / live location). Mirrors apps/rider/src/api/types.ts's
// own DeliverySummary/DeliveryDetail/CodSettlement exactly - the full row
// shape GET /riders/deliveries[/:id] actually returns
// (backend/api/src/modules/riders/rider.repository.ts). `MyDelivery` above
// (F2) stays a deliberately minimal subset for Home's active-delivery card;
// Queue/Detail need the whole state-machine shape to run `lib/delivery.ts`'s
// ported rules, so this is a distinct, broader type - not a duplicate (same
// precedent as F3's `HomeOrder`/`BoardOrder` pair).
export interface DeliverySummary {
  delivery_id: string;
  order_id: string;
  assignment_status: AssignmentStatus;
  assigned_at: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  order_number: string;
  order_status: OrderStatus;
  total_amount: number;
  payment_method: 'COD' | 'ONLINE';
  payment_status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  /** Migration 024: a second number from the address; null when none was given. */
  delivery_alternate_phone?: string | null;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  /** The customer's pin. NUMERIC columns can arrive as strings; see lib/route.ts toLatLng. */
  delivery_latitude?: number | string | null;
  delivery_longitude?: number | string | null;
  delivery_instructions: string | null;
}

export interface DeliveryItem {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  item_status: string;
}

/** `GET /riders/deliveries/:id`. `rider_id` is the caller's own linked rider
 * (never used for identity by the client - identity is always the bearer
 * token; this field is only ever displayed, never sent). */
export interface DeliveryDetail extends DeliverySummary {
  rider_id: string;
  cod_collected_amount: number;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  items: DeliveryItem[];
}

/** Vehicle types a staff rider can pick (backend rider.profile.ts). */
export type VehicleType = 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'THREE_WHEELER' | 'CAR';

/** `GET|POST /riders/me/profile`: the signed-in user's own rider profile. */
export interface RiderProfile {
  id: string;
  vehicle_type: VehicleType | string;
  vehicle_registration_number: string;
  emergency_contact_phone: string | null;
  is_active: boolean;
}

/** Roles an existing account can be moved between (ADMIN callers only). */
export type StaffRole = 'PACKING_STAFF' | 'OPERATIONS';

/** Roles a new account can be created with (backend staff.service.ts permission matrix). */
export type CreatableRole = 'ADMIN' | 'OPERATIONS' | 'PACKING_STAFF' | 'RIDER';

/** `GET /admin/staff` row: accounts the caller may not change come back read_only. */
export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  /** null for Admin and Inventory accounts (email + password only). */
  phone: string | null;
  role: CreatableRole;
  has_password: boolean;
  disabled: boolean;
  read_only: boolean;
  created_at: string;
  /** A Rider's rider profile, or an Operations/Admin "Can deliver" one; null when none. */
  rider?: {
    id: string;
    is_active: boolean;
    vehicle_type: string;
    vehicle_registration_number: string;
    emergency_contact_phone?: string | null;
  } | null;
}

export interface CreateStaffInput {
  full_name: string;
  email: string;
  password: string;
  role: CreatableRole;
  /** Required for Rider and Operations accounts; never sent for Inventory or Admin. */
  phone?: string;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface UpdateStaffInput {
  full_name?: string;
  role?: StaffRole;
  password?: string;
  disabled?: boolean;
  /** A Sri Lankan mobile number. */
  phone?: string;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface RiderProfileInput {
  vehicle_type: VehicleType;
  vehicle_registration_number: string;
  emergency_contact_phone?: string | null;
}

/** "My day" (`GET /riders/me/day`): counts and cash, no pay. */
export interface DayTotals {
  completed: number;
  failed: number;
  customer_unavailable: number;
  cash_collected: number;
}

export interface RiderDayDelivery {
  delivery_id: string;
  order_number: string;
  outcome: 'DELIVERED' | 'FAILED' | 'CUSTOMER_UNAVAILABLE';
  at: string;
  cash_collected: number;
}

export interface RiderDay {
  timezone: 'Asia/Colombo';
  today: DayTotals & { date: string };
  week: DayTotals & { starts_on: string };
  deliveries_today: RiderDayDelivery[];
}

/** The response of `POST /riders/deliveries/:id/collect-cod`. */
export interface CodSettlement {
  delivery_id: string;
  order_id: string;
  order_status: 'DELIVERED';
  payment_status: 'PAID';
  cod_collected_amount: number;
  delivered_at: string;
}

// ------------------------------------------------------------------ dental
/**
 * `GET /admin/dental/appointments` / `POST .../:id/cancel` (task F9, plan
 * §20-21). F2 (Home) originally defined `AdminAppointment` as a `{id}`-only
 * placeholder (see `HomeOrder`'s comment for that convention), since Home
 * only ever read `.length`. This task widens it to the full row the
 * Appointments screen actually renders - cross-checked field-for-field
 * against the real backend DTO mapping
 * (`backend/api/src/modules/dental/dental-admin.service.ts`'s
 * `toAdminAppointmentDto`) and against Admin's own already-reviewed
 * `AdminAppointment` (apps/admin/src/api/types.ts), which match exactly - a
 * compatible superset, so Home's own `.length`-only usage is unaffected
 * (the same widening precedent F3/F6 used for `RiderOption`/`QueueOrder`).
 */

/** From `appointment.schema.ts`'s `APPOINTMENT_LIST_STATUSES` - the raw,
 * never-relabelled status column (a stale HELD row stays `HELD`; see
 * `AdminAppointment.is_expired_hold`). */
export const DENTAL_APPOINTMENT_STATUSES = [
  'HELD',
  'EXPIRED',
  'CONFIRMED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_CLINIC',
] as const;
export type DentalAppointmentStatus = (typeof DENTAL_APPOINTMENT_STATUSES)[number];

/** A row of `GET /admin/dental/appointments`, including the derived
 * `is_expired_hold`/`is_completed` flags (status itself is never relabelled
 * - see `dental-admin.service.ts`'s own doc comment on why). */
export interface AdminAppointment {
  id: string;
  clinic_doctor_id: string;
  customer_id: string;
  start_at: string;
  end_at: string;
  status: DentalAppointmentStatus;
  held_until: string | null;
  is_expired_hold: boolean;
  is_completed: boolean;
  patient_name: string | null;
  patient_phone: string | null;
  patient_notes: string | null;
  consultation_fee_snapshot: number | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  created_at: string;
  doctor: { id: string; full_name: string; specialty: DentalSpecialty };
  clinic: { id: string; name: string; city: string };
}

export interface AdminAppointmentListResult {
  appointments: AdminAppointment[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// Task F8 (Dental clinic management: clinics, doctors, clinic-doctor
// pairings, availability, blocked dates - plan §15-19). Mirrors Admin's own
// `DentalClinic`/`DentalDoctor`/`ClinicDoctor`/`ClinicDoctorRosterRow`/
// `DoctorAvailability`/`DoctorBlockedDate` (apps/admin/src/api/types.ts)
// field-for-field, cross-checked against the real backend DTO mapping
// functions (`backend/api/src/modules/dental/dental-admin.service.ts`'s own
// `toXDto` functions) - nothing invented (common.md rule 7).

/** Exact enum from B1's migration (`dental_specialty_enum`,
 * dental-admin.schema.ts's `DENTAL_SPECIALTIES`) - never guessed, verified
 * directly against the real backend source this session. */
export const DENTAL_SPECIALTIES = [
  'GENERAL_DENTIST',
  'ORTHODONTIST',
  'PERIODONTIST',
  'ENDODONTIST',
  'ORAL_SURGEON',
  'PEDIATRIC_DENTIST',
] as const;
export type DentalSpecialty = (typeof DENTAL_SPECIALTIES)[number];

export const DENTAL_SPECIALTY_LABEL: Record<DentalSpecialty, string> = {
  GENERAL_DENTIST: 'General dentist',
  ORTHODONTIST: 'Orthodontist',
  PERIODONTIST: 'Periodontist',
  ENDODONTIST: 'Endodontist',
  ORAL_SURGEON: 'Oral surgeon',
  PEDIATRIC_DENTIST: 'Pediatric dentist',
};

/** GET/POST/PATCH /admin/dental/clinics - no hard delete, `is_active` toggle
 * only (verified against the real route table - no DELETE is registered). */
export interface DentalClinic {
  id: string;
  name: string;
  city: string;
  address_line: string;
  latitude: number;
  longitude: number;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** GET/POST/PATCH /admin/dental/doctors - no hard delete, `is_active` toggle
 * only. */
export interface DentalDoctor {
  id: string;
  full_name: string;
  specialty: DentalSpecialty;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Migration 023: visible (not hidden) ratings; the list endpoint sends
   * them, create/update responses do not. */
  rating_average?: number | null;
  rating_count?: number;
}

/** One rating, as GET /admin/dental/doctors/:id/ratings lists it (hidden
 * ones included, for staff). */
export interface DoctorRating {
  id: string;
  appointment_id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  hidden_at: string | null;
  is_hidden: boolean;
  visit_at: string;
  patient_name: string | null;
  clinic: { id: string; name: string };
}

export interface DoctorRatingsResult {
  doctor: { id: string; full_name: string; rating_average: number | null; rating_count: number };
  hidden_count: number;
  ratings: DoctorRating[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

/** The `clinic_doctors` join row itself, as attach/PATCH return it. */
export interface ClinicDoctor {
  id: string;
  clinic_id: string;
  doctor_id: string;
  consultation_fee: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A row of `GET /admin/dental/clinics/:clinic_id/doctors` - the admin
 * roster view (includes inactive pairings and inactive doctors, unlike the
 * public endpoint). */
export interface ClinicDoctorRosterRow {
  clinic_doctor_id: string;
  doctor_id: string;
  full_name: string;
  specialty: DentalSpecialty;
  photo_url: string | null;
  bio: string | null;
  doctor_is_active: boolean;
  consultation_fee: number | null;
  pairing_is_active: boolean;
}

/** A row of `GET /admin/dental/clinic-doctors/:clinic_doctor_id/availability`. */
export interface DoctorAvailability {
  id: string;
  clinic_doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A row of `GET /admin/dental/clinic-doctors/:clinic_doctor_id/blocked-dates`. */
export interface DoctorBlockedDate {
  id: string;
  clinic_doctor_id: string;
  blocked_date: string;
  reason: string;
  created_by: string;
  created_at: string;
}

// ------------------------------------------------------------------ catalog
// Task F5 (Catalog: products, categories, promotions, plan §12). Mirrors
// Admin's own `Category`/`AdminProduct`/`CustomerProduct`/`Paginated<T>`/
// `Promotion` (apps/admin/src/api/types.ts) field-for-field - verified
// against the real backend rows (`catalog.repository.ts`'s
// `v_product_catalog` view, `catalog.service.ts`'s admin/customer DTOs,
// `promotion.service.ts`), nothing invented (common.md rule 7).
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  /** Migration 010. Absent on an API from before it - read as the centre. */
  image_focal_x?: number;
  image_focal_y?: number;
  /** Live, non-deleted products in this category (added with category
   * delete). Absent on an older API - treat as unknown, not zero. */
  product_count?: number;
  /** The Home tile group this category sits in (null = unassigned).
   * Absent on an API from before category groups. */
  group_id?: string | null;
  group_sort_order?: number;
  /** The category this one sits inside (null = top level; one level only).
   * Absent on an API from before sub-categories. */
  parent_id?: string | null;
}

/** A category as listed inside a group (`GET /admin/category-groups`). */
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
  /** Ordered by `group_sort_order`. */
  categories: GroupCategory[];
}

/** `GET /admin/category-groups`: groups in order, plus live categories in no group. */
export interface CategoryGroupsOverview {
  groups: CategoryGroup[];
  unassigned: GroupCategory[];
}

/** `DELETE /admin/category-groups/:id` - its categories become unassigned. */
export interface CategoryGroupDeleteResult {
  group_id: string;
  released_category_count: number;
}

/**
 * `GET /admin/products`/`GET /admin/products/:id` - includes the internal
 * cost fields the customer never sees. Stock tracking is deliberately
 * absent: `tracking_mode` lives on the `inventory` table, out of this app's
 * scope for Phase 1 (plan §13).
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
  /**
   * Migration 009. Where the crop anchors when the customer app draws this
   * photo into a fixed tile, as a percentage of the image's own width and
   * height. 50/50 is the centre - the crop every image already had.
   */
  image_focal_x?: number;
  image_focal_y?: number;
  purchase_cost: number;
  custom_markup_percent: number | null;
  effective_markup_percent?: number;
  calculated_selling_price?: number;
  selling_price?: number;
  is_available: boolean;
  is_active: boolean;
  updated_at?: string;
}

/** `GET /catalog/products` (the public customer listing) - no cost or
 * markup fields. Kept for `catalog.products.listPublic()` (the endpoint the
 * brief names alongside `GET /admin/products`), not used by the primary
 * Products screen - see `resources.ts`'s doc comment for why. */
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

export interface Paginated<T> {
  products: T[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

/**
 * `IMAGE` is a photograph the app scrims and draws its own headline over.
 * `ARTWORK` is a finished banner drawn full-bleed - no scrim, no headline,
 * no subtitle. Both store their file in `background_image_url`.
 */
export type PromotionBackgroundType = 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';
export type PromotionDestinationType = 'CATEGORY' | 'PRODUCT' | 'CATALOG';

export interface Promotion {
  id: string;
  title: string;
  subtitle: string | null;
  /** Foreground promotional/product visual. */
  image_url: string | null;
  background_type: PromotionBackgroundType;
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  /**
   * Migration 009. Where the card's `cover` crop anchors on
   * `background_image_url`, as a percentage of that image's own width and
   * height. Shared by IMAGE and ARTWORK because they share the file.
   * 50/50 is the centre, i.e. today's behaviour.
   */
  background_focal_x?: number;
  background_focal_y?: number;
  cta_label: string | null;
  cta_destination_type: PromotionDestinationType | null;
  cta_destination_value: string | null;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------- inventory
// Task F6 (Inventory: stock, ledger, sourcing, suppliers - plan §13,
// common.md's OPS-04 scope decision). Mirrors `apps/inventory/src/api/types.ts`
// field-for-field - that app's own doc comment already states its shapes were
// "Captured from the running API", and this task's report verified every
// endpoint against the same real route table (`backend/api/src/modules/admin/
// index.ts`) F3/F5 each verified their own domains against, so these are
// treated as ground truth, not re-derived from scratch (common.md rule 7: no
// field invented). No role dimension: Inventory's own `Role`/`can()` matrix
// exists only to keep `PACKING_STAFF` out of ADMIN-only actions
// (adjustStock/changeTrackingMode/manageSuppliers) - the Operations operator
// is always `ADMIN`, so every one of those routes is already open to it with
// zero backend change (verified directly against the route table: those four
// mutations are gated `requireRoles('ADMIN')` alone, every read
// `requireRoles(['ADMIN','PACKING_STAFF'])`).
export type TrackingMode = 'TRACKED' | 'UNTRACKED';

/** A row of `GET /admin/inventory` - every catalog product, tracked or not. */
export interface StockRow {
  inventory_id: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  category_name: string;
  /** Owned by Admin/Catalog; read-only here. */
  is_active: boolean;
  /** Owned by Admin/Catalog; read-only here. */
  is_available: boolean;
  tracking_mode: TrackingMode;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  updated_at: string | null;
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

/** Types an operator may record by hand - the other three are system-written
 * (order reservation/fulfilment/cancellation-restore), never offered as a
 * manual choice (mirrors Inventory's own backend-contract comment). */
export type ManualAdjustmentType = 'PURCHASE_RESTOCK' | 'DAMAGE_WRITE_OFF' | 'INVENTORY_AUDIT_ADJUSTMENT';

/** `GET /admin/inventory/:productId` (`purchase_cost` is not returned by
 * this endpoint - it never needs to be shown here). */
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
  actor_role?: UserRole | null;
}

/** A row of `GET /admin/inventory/adjustments`. */
export interface LedgerEntry extends DetailAdjustment {
  inventory_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  actor_name: string | null;
}

/**
 * A minimal row of `GET /admin/orders` filtered to the two sourceable
 * statuses - see `resources.ts`'s `orders.needingPacking()` doc comment for
 * the widening this reuses (F2's counting query, widened by this task rather
 * than duplicated - real fields the endpoint already returns, nothing added).
 */
export interface QueueOrder {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  placed_at: string;
}

export type ItemStatus = 'PENDING' | 'SOURCED' | 'PACKED' | 'UNAVAILABLE' | 'SUBSTITUTED';

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

// ------------------------------------------------ delete / fee / low stock / import
/** `DELETE /admin/products/:id` - HARD when it was never ordered, SOFT when
 * order history keeps the row (hidden everywhere, never orderable again). */
export interface ProductDeleteResult {
  product_id: string;
  mode: 'HARD' | 'SOFT';
}

export interface CategoryDeleteResult {
  category_id: string;
  moved_product_count: number;
  mode: 'HARD' | 'SOFT';
}

/** `GET|PATCH /admin/settings/delivery-fee`. */
export interface DeliveryFeeSetting {
  fee_lkr: number;
  updated_at: string | null;
}

/** One row of `GET /admin/inventory/low-stock` (TRACKED, active products). */
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
  stock_state: 'OUT' | 'LOW';
}

export interface LowStockResult {
  items: LowStockItem[];
  counts: { low: number; out: number; total: number };
}

/** A spreadsheet row sent to `POST /admin/products/import`. */
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

export interface ImportRowResult {
  row: number;
  sku: string | null;
  status: ImportStatus;
  product_id?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface ImportResult {
  dry_run: boolean;
  summary: { created: number; updated: number; skipped: number; errors: number };
  results: ImportRowResult[];
}

// -------------------------------------------------------------------- cash
/** Rider cash hand-ins (backend migration 019). ADMIN and OPERATIONS. */
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

/** GET /admin/cash/reconciliation - one Sri Lanka day. */
export interface CashReconciliation {
  date: string;
  timezone: string;
  riders: RiderReconciliation[];
  totals: { collected: number; handed_in: number; difference: number; status: ReconciliationStatus };
}

// -------------------------------------------------------------- sms offers
/** Offer SMS to registered customers (backend migration 027). ADMIN and OPERATIONS. */
export type SmsLanguage = 'si' | 'ta' | 'en';
export type SmsOfferAudience = 'ALL' | 'ORDERED_30D' | 'ORDERED_90D' | 'NEVER_ORDERED';

/** Body of `POST /admin/sms-offers/estimate` and `POST /admin/sms-offers`. */
export interface SmsOfferInput {
  audience: SmsOfferAudience;
  fallback_language: SmsLanguage;
  messages: Partial<Record<SmsLanguage, string>>;
}

/** `POST /admin/sms-offers/estimate` -> `data.estimate`. */
export interface SmsOfferEstimate {
  audience: SmsOfferAudience;
  recipients: number;
  /** Recipients per language they will be sent, after the fallback. */
  by_language: Record<SmsLanguage, number>;
  without_language: number;
  opted_out: number;
  parts_per_sms: Partial<Record<SmsLanguage, number>>;
  sms_parts_total: number;
  /** Languages that have recipients but no text yet (enabled languages only). */
  missing_languages: SmsLanguage[];
  /** Languages offers are written in right now (['en'] at launch). While a
   * language is off, its customers are sent an enabled one. */
  languages: SmsLanguage[];
}

/** `POST /admin/sms-offers` -> `data.offer`. */
export interface SmsOfferCreated {
  id: string;
  created_at: string;
  recipients: number;
  sms_parts_total: number;
}

/** `POST /admin/sms-offers/test` -> `data`. */
export interface SmsOfferTestResult {
  sent_to: string;
  sms_parts: number;
}

/** A row of `GET /admin/sms-offers` (newest first). */
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

/** Rider applications (backend migration 029). */
export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RiderApplication {
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
