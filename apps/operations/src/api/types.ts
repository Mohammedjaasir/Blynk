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
  /** Delivery slot start (null = as soon as possible). */
  scheduled_for: string | null;
  /** Delivery slot end (migration 036); null on older orders - show just the
   * start then (owner, 2026-10-10). */
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
  /** The product's unit at order time ("1 L", "500 g"); read by the packing slip. */
  unit_snapshot?: string | null;
  quantity: number;
  item_status: 'PENDING' | 'SOURCED' | 'PACKED' | 'UNAVAILABLE' | 'SUBSTITUTED';
  /**
   * Admin detail only. Read to tell a substitution with a recorded cost from
   * one without (what blocks packing); never rendered.
   */
  actual_unit_cost?: number | string | null;
  /** The product, for grouping a combo's split lines; absent on older data. */
  product_id?: string | null;
  /** The combo line (`OrderDetail.combos[].id`) this item was packed for;
   * null/absent = a loose item (migration 033; owner, 2026-10-09). */
  order_combo_id?: string | null;
}

/**
 * One combo pack line on an order (migration 033; owner, 2026-10-09): the
 * combo's name and price as ordered. Its contents are the order's ordinary
 * items whose `order_combo_id` is this `id`.
 */
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
  /** The customer's birthday gift (owner, 2026-10-09): when > 0 it is the
   * whole discount_amount and coupon_code is null. 0 / absent when none. */
  birthday_discount_amount?: number;
  total_amount: number;
  placed_at: string;
  scheduled_for: string | null;
  /** Delivery slot end (migration 036); null on older orders (owner, 2026-10-10). */
  scheduled_until?: string | null;
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
  /** Combo pack lines (migration 033). Absent on older data - no combos. */
  combos?: OrderCombo[];
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
  /** How the rider is paid (owner, 2026-10-09). Optional only because other
   * rows built from this shape (suggestions, fixtures) may leave it out. */
  pay_type?: RiderPayType;
  /** The rider's own commission %, or null for the store default. */
  commission_percent?: number | null;
  /** The rider's own pay model, or null when they follow the store default
   * model (owner, 2026-10-10). Missing on APIs from before rider pay models. */
  pay_model?: PayModel | null;
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

/** A doctor's specialty is free text since migration 030 (owner,
 * 2026-10-09): any specialty up to 64 characters, e.g. "Cosmetic dentist".
 * Show it through `specialtyLabel` (lib/dental.ts), which still reads an old
 * enum code (e.g. "ORTHODONTIST") correctly. */
export type DentalSpecialty = string;

/** Quick picks in the Add/Edit doctor dialog - suggestions only, the
 * operator can type any other specialty. */
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
  /**
   * Category offer (migration 033; owner, 2026-10-09): % off everything in
   * this category and its sub-categories, with an optional end.
   * `offer_active` is the backend's word on whether it runs right now.
   * Absent on an older API - read as "no offer".
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

/** A category as listed inside a group (`GET /admin/category-groups`). */
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
  /** In Arrange order (`display_order`, name; owner, 2026-10-10). */
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
  /**
   * Offer price (owner, 2026-10-09): the reduced price customers pay, as
   * stored, with an optional end. `offer_active` is the backend's word on
   * whether it applies right now (set, not ended, below the selling price) -
   * never worked out here. Optional so an API from before migration 031
   * still reads as "no offer".
   */
  offer_price?: number | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
  /** Migration 033: the category % offer reaching this product, and what a
   * customer pays right now (the best active offer). Absent on older APIs. */
  category_offer_percent?: number | null;
  category_offer_ends_at?: string | null;
  customer_price?: number;
  is_available: boolean;
  is_active: boolean;
  updated_at?: string;
}

/** One product in a combo pack (`GET /admin/combos`; owner, 2026-10-09). */
export interface ComboItem {
  product_id: string;
  name: string;
  slug: string;
  sku: string;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x?: number;
  image_focal_y?: number;
  quantity: number;
  /** The regular price. */
  selling_price: number;
  /** The price today, offers included. */
  unit_price: number;
  is_active: boolean;
  is_available: boolean;
  in_stock: boolean;
  /** Tracked units free; null = untracked. */
  stock_available: number | null;
}

export type ComboNotLiveReason = 'INACTIVE' | 'ENDED' | 'ITEM_INACTIVE' | 'NOT_CHEAPER';

/**
 * A combo pack (migration 033; owner, 2026-10-09): several products sold
 * together for one price lower than buying them separately. `is_live` /
 * `not_live_reason` / `is_available` are the backend's word - never worked
 * out here.
 */
export interface Combo {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  items: ComboItem[];
  /** One pack's items at today's prices. */
  items_total: number;
  saving: number;
  is_live: boolean;
  is_available: boolean;
  not_live_reason: ComboNotLiveReason | null;
}

/** `POST /admin/combos` body; PATCH takes any subset (`items` replaces the list). */
export type ComboInput = {
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at?: string | null;
  display_order?: number;
  items: Array<{ product_id: string; quantity: number }>;
};

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

/** One row of a per-km tier table (owner, 2026-10-10): `lkr` is what km
 * number `km` (1..n, in order) adds; the last row repeats for longer trips. */
export interface KmTier {
  km: number;
  lkr: number;
}

/** FLAT = everyone pays `fee_lkr`; DISTANCE_TIERS = the tier table on the
 * road distance hub -> address, optionally capped (owner, 2026-10-10). */
export type DeliveryFeeMode = 'FLAT' | 'DISTANCE_TIERS';

/** `GET|PATCH /admin/settings/delivery-fee`. The mode, tiers and cap are
 * optional only because an API from before per-km tiers leaves them out
 * (treated as FLAT). */
export interface DeliveryFeeSetting {
  fee_lkr: number;
  fee_mode?: DeliveryFeeMode;
  /** May be [] when never set. */
  tiers?: KmTier[];
  /** null = no cap. */
  max_fee_lkr?: number | null;
  updated_at: string | null;
}

/** Body of `PATCH /admin/settings/delivery-fee` (omitted = keep). */
export interface DeliveryFeeInput {
  fee_lkr?: number;
  fee_mode?: DeliveryFeeMode;
  tiers?: KmTier[];
  max_fee_lkr?: number | null;
}

/** `GET|PATCH /admin/settings/checkout` - checkout switches (owner, 2026-10-08). */
export interface CheckoutSettings {
  coupons_enabled: boolean;
  /** Every customer, existing ones too, gets `count` free deliveries,
   * counting only orders placed on or after `since` (ISO; owner, 2026-10-09).
   * The key name predates that decision. */
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  /** The customer app shows "Save LKR X" on offers (owner, 2026-10-10).
   * Optional: a backend from before the switch leaves it out (= off). */
  show_offer_savings?: boolean;
  updated_at: string | null;
}

/** `GET|PATCH /admin/settings/birthday-offer` - X% off ONE order in the
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

/** One row of `GET /admin/birthdays`. */
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
  /** handed_in - expected_handin: negative = short. */
  difference: number;
  status: ReconciliationStatus;
  pay_type: RiderPayType;
  /** The commission share a COMMISSION rider keeps out of the cash; 0 for company riders (owner, 2026-10-09). */
  kept_share: number;
  /** collected - kept_share - day_bonuses - adjustments, never below 0: what the rider should hand in. */
  expected_handin: number;
  /** Daily-target bonuses earned that day (owner, 2026-10-10). Optional: older APIs lack it. */
  day_bonuses?: number;
  /** That day's pay adjustments, signed: negative = deduction (owner, 2026-10-10). */
  adjustments?: number;
  /** What Blynk owes the rider because the day's cash could not cover their pay (owner, 2026-10-10). */
  payable_to_rider?: number;
}

/** GET /admin/cash/reconciliation - one Sri Lanka day. */
export interface CashReconciliation {
  date: string;
  timezone: string;
  riders: RiderReconciliation[];
  totals: {
    collected: number;
    handed_in: number;
    kept_share: number;
    expected_handin: number;
    /** handed_in - expected_handin. */
    difference: number;
    status: ReconciliationStatus;
    /** Owner, 2026-10-10 - optional: older APIs lack them. */
    day_bonuses?: number;
    adjustments?: number;
    payable_to_rider?: number;
  };
}

// --------------------------------------------------------------- rider pay
/**
 * Rider pay (owner, 2026-10-09): a COMPANY rider is salaried and earns no
 * per-delivery commission (Blynk keeps the delivery charge); a COMMISSION
 * rider earns a % of the standard delivery fee - the store default or their
 * own override - and keeps that share out of the COD cash they collect.
 */
export type RiderPayType = 'COMPANY' | 'COMMISSION';

// Rider pay controls (owner, 2026-10-10: "give the option in ops and admin to
// control the rider app charges") - pay model per store and rider, bonuses,
// rain boost and adjustments. See the rider-pay API contract.
/** % of the delivery fee, fixed LKR per delivery, or base + per km. */
export type PayModel = 'PERCENT' | 'FIXED' | 'DISTANCE';
/** +LKR per delivery, or +% of the delivery's base earning. */
export type BoostMode = 'FIXED' | 'PERCENT';
export type BonusKind = 'PEAK_BOOST' | 'RAIN_BOOST' | 'LONG_DISTANCE' | 'DAILY_TARGET';
export type AdjustmentReason = 'CASH_SHORT' | 'DAMAGED_ITEM' | 'LATE' | 'BONUS' | 'OTHER';

/** A complete pay model (the store default or a rider's effective one). */
export interface PayParams {
  model: PayModel;
  /** PERCENT: % of the order's standard delivery fee (0..100). */
  percent: number;
  /** FIXED: LKR per delivery. */
  fixed_lkr: number;
  /** DISTANCE: base LKR per delivery... */
  base_lkr: number;
  /** ...plus LKR per km of road distance store -> drop-off. */
  per_km_lkr: number;
  /** Optional floor per delivery (any model); null = no floor. */
  min_lkr: number | null;
  /** DISTANCE only (owner, 2026-10-10): LINEAR = base + per km (above);
   * TIERS = the per-km tier table `km_tiers` (no cap; the minimum still
   * applies). Optional: an API from before per-km tiers leaves them out
   * (treated as LINEAR). */
  distance_mode?: DistanceMode;
  km_tiers?: KmTier[];
}

/** How DISTANCE pay is worked out (owner, 2026-10-10). */
export type DistanceMode = 'LINEAR' | 'TIERS';

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
  /** Up to 10 windows. */
  windows: PeakWindow[];
}

export interface DailyTargetTier {
  deliveries: number;
  amount_lkr: number;
}

export interface DailyTargetRule {
  enabled: boolean;
  /** Up to 5 tiers, deliveries unique 1..100. */
  tiers: DailyTargetTier[];
}

export interface LongDistanceRule {
  enabled: boolean;
  /** 0.5..50 km. */
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
  /** on && (auto_off_at null || now < auto_off_at). */
  active: boolean;
}

/** `GET /admin/settings/rider-pay` (and every rider-pay PATCH's reply). */
export interface RiderPaySettings {
  /** default_model.percent is the same value as the rider-commission setting. */
  default_model: PayParams;
  bonus_rules: BonusRules;
  rain_boost: RainBoost;
}

/** Body of `PATCH /admin/settings/rider-pay/model` (omitted = keep). */
export interface RiderPayModelInput {
  model: PayModel;
  percent?: number;
  fixed_lkr?: number;
  base_lkr?: number;
  per_km_lkr?: number;
  min_lkr?: number | null;
  /** Owner, 2026-10-10: DISTANCE + TIERS needs km_tiers (sent or stored). */
  distance_mode?: DistanceMode;
  km_tiers?: KmTier[];
}

/** Body of `PATCH /admin/settings/rider-pay/bonuses`: each section sent complete. */
export type RiderPayBonusesInput = Partial<BonusRules>;

/** Body of `PATCH /admin/settings/rider-pay/rain-boost` (turning off clears auto_off_at). */
export interface RainBoostInput {
  on: boolean;
  mode?: BoostMode;
  amount?: number;
  /** In the future, within 7 days; null = until staff turn it off. */
  auto_off_at?: string | null;
}

/** `GET|PATCH /admin/riders/:id/pay` -> `data.pay`. */
export interface RiderPay {
  rider_id: string;
  pay_type: RiderPayType;
  /** The rider's own override, or null for the store default. */
  commission_percent: number | null;
  /** The % actually used: a number for COMMISSION, null for COMPANY. */
  effective_percent: number | null;
  default_percent: number;
  /** The rider's own model; null = follows the store default model (owner,
   * 2026-10-10). This and the fields below are optional: an API from before
   * rider pay models leaves them out. */
  pay_model?: PayModel | null;
  /** null each = the store default value. */
  own?: {
    fixed_lkr: number | null;
    base_lkr: number | null;
    per_km_lkr: number | null;
    min_lkr: number | null;
    /** Owner, 2026-10-10: null (or missing on an older API) = the store default's. */
    distance_mode?: DistanceMode | null;
    km_tiers?: KmTier[] | null;
  };
  /** What a new delivery pays this rider now; null for COMPANY. */
  effective?: PayParams | null;
  default_model?: PayParams;
}

/** Body of `PATCH /admin/riders/:id/pay` and the optional approve body (the
 * approve body takes the same pay fields - owner, 2026-10-10). */
export interface RiderPayInput {
  pay_type: RiderPayType;
  commission_percent?: number | null;
  /** Owner, 2026-10-10: null = follow the store default model. */
  pay_model?: PayModel | null;
  fixed_lkr?: number | null;
  base_lkr?: number | null;
  per_km_lkr?: number | null;
  min_lkr?: number | null;
  /** Owner, 2026-10-10: kept only when pay_model is DISTANCE; null = the store default's. */
  distance_mode?: DistanceMode | null;
  km_tiers?: KmTier[] | null;
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

/** Body of `POST /admin/riders/:id/adjustments` (any of these for its PATCH). */
export interface RiderAdjustmentInput {
  amount_lkr: number;
  reason: AdjustmentReason;
  note?: string | null;
  /** Default today; not in the future, at most 400 days back. */
  adjustment_date?: string;
}

/** `GET|PATCH /admin/settings/rider-commission`. */
export interface RiderCommissionSetting {
  default_percent: number;
  updated_at: string | null;
}

export type EarningsRange = 'today' | 'this_week' | 'custom';

export interface RiderEarningsFigures {
  deliveries: number;
  /** On the standard-fee basis, whatever the customer actually paid. */
  delivery_charges: number;
  /** What customers paid for delivery (0 on free deliveries). */
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
  // Owner, 2026-10-10 - optional: an API from before rider pay models lacks them.
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
  /** base_earnings + delivery_bonuses + day_bonuses + adjustments. */
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

/** `GET /admin/reports/rider-earnings`. */
export interface RiderEarningsReport {
  range: { from: string; to: string; timezone: string };
  default_percent: number;
  riders: RiderEarningsRow[];
  totals: RiderEarningsFigures;
  /** The range's adjustments (owner, 2026-10-10). */
  adjustments?: RiderAdjustment[];
  /** The store default pay model (owner, 2026-10-10). */
  default_model?: PayParams;
}

export interface MyEarningsPeriod {
  deliveries: number;
  delivery_charges: number;
  /** The total, incl. bonuses and adjustments (owner, 2026-10-10). */
  earnings: number;
  cash_collected: number;
  cash_to_keep: number;
  cash_to_hand_in: number;
  // Owner, 2026-10-10 - optional: older APIs lack them.
  base_earnings?: number;
  delivery_bonuses?: number;
  day_bonuses?: number;
  /** delivery_bonuses + day_bonuses. */
  bonuses?: number;
  additions?: number;
  deductions?: number;
  adjustments?: number;
  payable_to_rider?: number;
}

/** Owner, 2026-10-10: today's bonuses grouped by kind (only non-zero). */
export interface MyBonusLine {
  kind: BonusKind;
  amount_lkr: number;
  count: number;
}

export interface MyAdjustmentLine {
  id: string;
  amount_lkr: number;
  reason: AdjustmentReason;
  note: string | null;
}

/** `GET /riders/me/earnings` - the signed-in user's own rider profile. */
export interface MyEarnings {
  timezone: string;
  pay_type: RiderPayType;
  /** Effective %, null for COMPANY. */
  commission_percent: number | null;
  today: MyEarningsPeriod & { date: string; bonus_lines?: MyBonusLine[]; adjustment_lines?: MyAdjustmentLine[] };
  week: MyEarningsPeriod & { starts_on: string };
  /** Effective model (null for COMPANY) - owner, 2026-10-10; optional for older APIs. */
  pay_model?: PayParams | null;
  boosts?: {
    /** Automatic bonuses apply to this rider. */
    applies: boolean;
    rain: { active: boolean; mode: BoostMode; amount: number; until: string | null };
    peak: { active_now: boolean; mode: BoostMode; amount: number };
  };
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
  /** Set on approval (owner, 2026-10-09). */
  pay_type?: RiderPayType;
  commission_percent?: number | null;
  /** The rider's own pay model once approved; null = the store default (owner, 2026-10-10). */
  pay_model?: PayModel | null;
  /** Rider documents (owner, 2026-10-10). Optional only for APIs from before migration 039. */
  documents?: StaffRiderDocument[];
  document_requirements?: RiderDocumentRequirement[];
  documents_blocking?: RiderDocumentBlocking[];
  /** true = every REQUIRED document is verified and not expired: Approve allowed. */
  documents_verified?: boolean;
}

export interface RiderApplicationPage {
  applications: RiderApplication[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ---------------------------------------------------------- rider documents
// Rider documents (backend migration 039; owner, 2026-10-10): vehicle book
// (CR), revenue licence, insurance certificate, driving licence (+ custom
// ones). Ops and Admin verify them before approving a rider.
export type RiderDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
/** EXPIRING = within 30 days (Colombo date). */
export type RiderDocumentExpiryState = 'EXPIRED' | 'EXPIRING' | 'OK';
export type RiderDocumentRejectReason = 'BLURRY' | 'EXPIRED' | 'NAME_MISMATCH' | 'WRONG_DOCUMENT' | 'OTHER';

export interface RiderDocumentPage {
  index: number;
  content_type: string;
  bytes: number;
  uploaded_at: string;
}

export interface StaffRiderDocument {
  id: string;
  rider_id: string | null;
  doc_type: string;
  label: string;
  custom: boolean;
  /** 0 = front, 1 = back. */
  pages: RiderDocumentPage[];
  pages_needed: 1 | 2;
  expiry_date: string | null;
  expiry_state: RiderDocumentExpiryState | null;
  status: RiderDocumentStatus;
  reject_reason: RiderDocumentRejectReason | null;
  reject_reason_label: string | null;
  reject_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  updated_at: string;
}

export interface RiderDocumentRequirement {
  key: string;
  label: string;
  /** Required for THIS rider's vehicle type. */
  required: boolean;
  needs_expiry: boolean;
  needs_back: boolean;
  document_id: string | null;
  status: RiderDocumentStatus | 'MISSING';
  expiry_state: RiderDocumentExpiryState | null;
}

export interface RiderDocumentBlocking {
  key: string;
  label: string;
  status: RiderDocumentStatus | 'MISSING';
  expiry_state: RiderDocumentExpiryState | null;
}

/** `GET /admin/riders/:riderId/documents`. */
export interface RiderDocumentsForRider {
  rider: { id: string; full_name: string | null; vehicle_type: string; approval_status: RiderApprovalStatus };
  documents: StaffRiderDocument[];
  requirements: RiderDocumentRequirement[];
  blocking: RiderDocumentBlocking[];
  all_required_verified: boolean;
}

/** One row of `GET /admin/rider-documents/alerts` (approved riders only). */
export interface RiderDocumentAlert {
  document_id: string;
  rider_id: string;
  full_name: string | null;
  phone: string | null;
  doc_type: string;
  label: string;
  is_insurance: boolean;
  status: RiderDocumentStatus;
  expiry_date: string | null;
  expiry_state: 'EXPIRED' | 'EXPIRING';
}

/** A document type in Settings -> Rider documents. */
export interface RiderDocumentType {
  key: string;
  label: string;
  builtin: boolean;
  enabled: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
}

export interface RiderDocumentSettings {
  documents: RiderDocumentType[];
  updated_at: string | null;
}

/** `PUT /admin/settings/rider-documents` - a new custom document has no key. */
export interface RiderDocumentTypeInput {
  key?: string;
  label?: string;
  enabled: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
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

// ------------------------------------------------------------- coupons
/** Coupon codes customers type at checkout (backend migration 018). Admin
 * and Operations manage them (owner, 2026-10-10). */
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

// ------------------------------------------------------- store schedule
/** Opening hours, close-now, holidays and delivery slots, set by Ops and
 * Admin (owner, 2026-10-10: "make sure the timing will be decided by ops
 * and admin"). All times Asia/Colombo; 'HH:MM' is 24h on 15-minute steps. */
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
  date: string;
  reason: string | null;
}

export type SlotMinutes = 30 | 60 | 120;

export interface DeliverySlotSettings {
  enabled: boolean;
  slot_minutes: SlotMinutes;
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

/** GET /admin/settings/store-schedule; every store-schedule PATCH returns it too. */
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
