import { apiRequest, tokenStore, type Query } from './client';
import { isNativeApp, nativeApiRequest } from './native-client';
import type {
  EarningsRange,
  MyEarnings,
  RiderCommissionSetting,
  RiderEarningsReport,
  RiderPay,
  RiderPayInput,
  RiderApplication,
  RiderApplicationPage,
  RiderApprovalStatus,
  AdjustmentType,
  AdminAppointment,
  AdminAppointmentListResult,
  AdminProduct,
  AuthUser,
  BoardOrder,
  Category,
  CategoryDeleteResult,
  Combo,
  ComboInput,
  CategoryGroup,
  CategoryGroupDeleteResult,
  CategoryGroupsOverview,
  ClinicDoctor,
  ClinicDoctorRosterRow,
  CodSettlement,
  CustomerProduct,
  DeliveryDetail,
  DeliveryFeeSetting,
  CheckoutSettings,
  BirthdayOfferSetting,
  BirthdayOfferInput,
  BirthdaysResult,
  DeliverySummary,
  RiderDay,
  RiderProfile,
  RiderProfileInput,
  DentalAppointmentStatus,
  DentalClinic,
  DentalDoctor,
  DoctorAvailability,
  DoctorRatingsResult,
  DoctorBlockedDate,
  HomeOrder,
  ImportResult,
  ImportRow,
  LedgerEntry,
  LowStockResult,
  ManualAdjustmentType,
  MyDelivery,
  OrderDetail,
  Paginated,
  Pagination,
  ProductDeleteResult,
  Promotion,
  QueueOrder,
  RiderOption,
  RiderSuggestions,
  StockDetail,
  StockRow,
  Supplier,
  SupplierInput,
  TrackingMode,
  CashHandin,
  CashReconciliation,
  CreateStaffInput,
  StaffAccount,
  UpdateStaffInput,
  SmsLanguage,
  SmsOffer,
  SmsOfferCreated,
  SmsOfferEstimate,
  SmsOfferInput,
  SmsOfferTestResult,
} from './types';

/**
 * Typed wrappers over the existing Blynk endpoints, grouped by domain.
 *
 * DOMAIN-GROUPING CONVENTION (every later Operations task reads this before
 * touching this file):
 * - One `export const <domain> = { ... }` block per backend domain area,
 *   named after the noun it wraps - `auth` (this task), then `orders`,
 *   `delivery`, `catalog`, `inventory`, `riders`, `dental` as later tasks
 *   add them. This exactly mirrors Admin's own `resources.ts` (`auth`,
 *   `categories`, `products`, `promotions`, `orders`, `riders`,
 *   `dentalClinics`, `dentalDoctors`, ...) - one block per noun, not one
 *   block per screen.
 * - Each function unwraps the endpoint's own inner envelope key (e.g.
 *   `.then((d) => d.clinics)`) so callers get the actual value they need,
 *   never the raw `{ clinics: [...] }` wrapper - `apiRequest<T>()` already
 *   strips the outer `{success, data}` envelope; each wrapper here strips
 *   the next noun-keyed layer underneath it, exactly as Admin's does.
 * - **F1 built ONLY the `auth` block. F2 (Home) appended the `orders`,
 *   `riders` and `dental` blocks; F3 (Orders board/detail) extended `orders`
 *   and `riders`; F4 (Delivery Mode) added the `delivery` block; F5
 *   (Catalog) added the `catalog` block; F6 (Inventory) added the new
 *   `inventory` block below and widened `orders.needingPacking()`'s return
 *   type (see that function's own doc comment); F7 (rider list, plan §14,
 *   common.md rule 9) reused `riders.listActive()` exactly as-is - the roster
 *   screen needs nothing `RiderOption` doesn't already carry, so no new
 *   function was added here; F8 (Dental clinic management: clinics/doctors/
 *   pairings/availability/blocked-dates, plan §15-19) extended F2's `dental`
 *   block with `clinics`/`doctors`/`clinicDoctors`/`availability`/
 *   `blockedDates` sub-objects, leaving `appointments` untouched for F9; F9
 *   (Dental appointments + clinic location map, plan §20-21) then widened
 *   `appointments` itself from a single function into a `list`/`cancel`
 *   sub-object (see that block's own doc comment for why), the last piece
 *   of this domain.** - each an OPEN domain a later task may extend with
 *   more functions, but every new function must be a genuinely new call;
 *   check the domain's existing functions first. Never edit or remove the
 *   `auth` block.
 * - The one deliberate exception: the rider-profile-probe call
 *   (`GET /riders/deliveries`) used by `src/auth/riderProbe.ts` still calls
 *   `apiRequest` directly rather than `riders.myDeliveries()` below - it
 *   only needs the success/failure outcome, never the parsed list, so it
 *   was left as-is per F1's report §2 ("not required, since the probe's
 *   needs... are simpler... but worth a look at that point" - looked at,
 *   left unchanged: the probe would gain nothing from the extra parsing
 *   `myDeliveries()` does).
 */

// ---------------------------------------------------------------- auth
export const auth = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string; expires_in_minutes?: number }>('/auth/otp/request', {
      method: 'POST',
      body: { phone },
      auth: false,
    }),

  /** Staff email + password sign-in (backend migration 012). */
  staffLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  /** Staff only ever sign in to an EXISTING account: `create_account: false`
   * stops the API from creating a customer account for an unknown number -
   * it answers 404 ACCOUNT_NOT_FOUND instead. */
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp, create_account: false },
      auth: false,
    }),

  me: () => apiRequest<AuthUser>('/auth/me'),

  // Send the refresh token so the server revokes it: without it the route
  // knows neither the session nor the user, and the session outlives sign-out.
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', body: tokenStore.refresh ? { refresh_token: tokenStore.refresh } : {} }),
};

// ---------------------------------------------------------------- orders
// Task F2 (Home) built the four counting queries below; Task F3 (Orders
// board/detail) appended `live`/`closedSince`/`detail`/`setStatus`/
// `assignRider` - a distinct, broader query shape (the whole live board and
// full order detail, not one narrow status count), so these are genuinely
// new functions, not a duplicate of F2's. Same routes/query shape Admin's
// own `orders` block uses (apps/admin/src/api/resources.ts) - `status` is
// one value or a comma-separated list, `since` an ISO instant; the client's
// own `query` support (Inventory's `buildUrl` pattern, see client.ts) builds
// the querystring instead of each wrapper hand-assembling one.
const LIVE_STATUSES = 'PLACED,ITEM_UNAVAILABLE,PACKED,OUT_FOR_DELIVERY,FAILED,CUSTOMER_UNAVAILABLE';

/** The API's page size for `GET /admin/orders` (it refuses more). */
export const ORDER_PAGE_LIMIT = 100;
/** The most pages a list reads in one load (2,000 orders); past that it says so. */
export const ORDER_MAX_PAGES = 20;

/**
 * Orders plus the API's `pagination.total` - the real count. Counts shown to
 * the operator use `total`. An API without pagination falls back to the
 * page length. `truncated` is true only when `listAllOrders` stopped at
 * ORDER_MAX_PAGES with orders left unread.
 */
export interface OrderPage<T> {
  orders: T[];
  total: number;
  truncated: boolean;
}

/** One page - enough where only `total` is read (Home's counts). */
function listOrders<T>(query: Query): Promise<OrderPage<T>> {
  return apiRequest<{ orders: T[]; pagination?: Partial<Pagination> }>('/admin/orders', { query }).then((d) => ({
    orders: d.orders,
    total: Math.max(d.orders.length, Number(d.pagination?.total ?? d.orders.length) || 0),
    truncated: false,
  }));
}

/**
 * Every matching order: the pages are read in sequence up to
 * pagination.total_pages (at most ORDER_MAX_PAGES). An order that moved
 * between page reads is kept once.
 */
async function listAllOrders<T extends { id: string }>(query: Query): Promise<OrderPage<T>> {
  const read = (page: number) =>
    apiRequest<{ orders: T[]; pagination?: Partial<Pagination> }>('/admin/orders', {
      query: { ...query, page, limit: ORDER_PAGE_LIMIT },
    });
  const first = await read(1);
  const total = Math.max(first.orders.length, Number(first.pagination?.total ?? first.orders.length) || 0);
  const totalPages = Number(first.pagination?.total_pages ?? 1) || 1;
  const all = [...first.orders];
  for (let page = 2; page <= Math.min(totalPages, ORDER_MAX_PAGES); page += 1) {
    const next = await read(page);
    all.push(...next.orders);
    if (next.orders.length < ORDER_PAGE_LIMIT) break;
  }
  const seen = new Set<string>();
  const orders = all.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  return { orders, total, truncated: totalPages > ORDER_MAX_PAGES };
}

export const orders = {
  /**
   * Packing queue - `PLACED` (just placed) and `ITEM_UNAVAILABLE` (needs a
   * substitution decision before it can be packed). Task F6 (Inventory)
   * reuses this exact call for its own Sourcing queue rather than duplicating
   * it - its brief names it as "the `GET /admin/orders?status=
   * PLACED,ITEM_UNAVAILABLE&limit=100` resource function F3 already added";
   * verified against the real code before reusing it (matching F5's own
   * "verify the brief against real working code" discipline): this function
   * was actually added by **F2** (Home), not F3 - F3's own `live`/`closedSince`
   * below use a different, broader status set. Documented here rather than
   * silently corrected, per common.md's "report a genuine contradiction"
   * instruction. Widened from `HomeOrder[]` (`{id}`-only) to `QueueOrder[]`
   * by F6 - a structurally compatible superset (Home still only reads
   * `.length`), the same widening precedent F3 used for `riders.listActive()`.
   * The query itself is unchanged. */
  needingPacking: () => listOrders<QueueOrder>({ status: 'PLACED,ITEM_UNAVAILABLE', limit: ORDER_PAGE_LIMIT }),

  /** Packed, waiting for a rider to be assigned. */
  readyForRider: () => listOrders<HomeOrder>({ status: 'PACKED', limit: ORDER_PAGE_LIMIT }),

  onTheRoad: () => listOrders<HomeOrder>({ status: 'OUT_FOR_DELIVERY', limit: ORDER_PAGE_LIMIT }),

  /** `since` is the moment to count from (Home passes the start of today,
   * Asia/Colombo) - the same `since` semantics as Admin's `closedSince()`,
   * scoped to `DELIVERED` only per this task's brief (Admin's own
   * `closedSince` also includes `CANCELLED`; Home's "Completed today" figure
   * deliberately does not). */
  completedToday: (since: Date) =>
    listOrders<HomeOrder>({ status: 'DELIVERED', since: since.toISOString(), limit: ORDER_PAGE_LIMIT }),

  /** The Orders board's own live query (task F3) - every status that still
   * needs staff attention, oldest first (mirrors Admin's `orders.live()`). */
  live: () => listAllOrders<BoardOrder>({ status: LIVE_STATUSES }),

  /** Orders closed since a given moment (mirrors Admin's `orders.closedSince()`
   * exactly, including `DELIVERED,CANCELLED` - unlike `completedToday` above,
   * which this task's brief for F2 scoped to `DELIVERED` only). */
  closedSince: (since: Date) =>
    listAllOrders<BoardOrder>({ status: 'DELIVERED,CANCELLED', since: since.toISOString() }),

  /** One order's full detail - items, customer, rider, history. */
  detail: (id: string) => apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}`).then((d) => d.order),

  /** One lifecycle step (pack / hand-over / deliver / fail / customer-
   * unavailable / restage / cancel). The API is the only authority on
   * whether this status change is legal from the order's current state -
   * this call never decides that, only names the destination `lib/orders.ts`'s
   * rule table offered. */
  setStatus: (id: string, status: string, notes?: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: notes === undefined ? { status } : { status, notes },
    }),

  /** "Mark delivered" with proof of delivery (backend migration 016): the
   * customer's 4-digit code, or - when they cannot show it - a written
   * override note. The API records which one was used. */
  markDelivered: (id: string, proof: { deliveryCode: string } | { overrideNote: string }) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body:
        'deliveryCode' in proof
          ? { status: 'DELIVERED', delivery_code: proof.deliveryCode }
          : { status: 'DELIVERED', notes: proof.overrideNote },
    }),

  /** An item that is not on the shelf (lifecycle RESOLVE_ITEM): the API
   * removes it from the bill, recalculates the total and tells the customer. */
  markItemUnavailable: (orderId: string, itemId: string) =>
    apiRequest(`/admin/orders/${orderId}/resolve-item`, {
      method: 'POST',
      body: { item_id: itemId, item_status: 'UNAVAILABLE' },
    }),

  /** Manual dispatch - the rider's identity comes from the operator's own
   * choice in the AssignRiderDialog (an active rider `GET /admin/riders`
   * listed), never inferred or trusted from anywhere else. */
  assignRider: (id: string, riderId: string, confirmFarBatch = false) =>
    apiRequest<{ delivery: unknown }>(`/admin/orders/${id}/assign-rider`, {
      method: 'POST',
      // confirm_far_batch: the operator saw that this drop-off is far from the
      // rider's other one and adds it to the trip anyway.
      body: confirmFarBatch ? { rider_id: riderId, confirm_far_batch: true } : { rider_id: riderId },
    }),
};

// ---------------------------------------------------------------- riders
export const riders = {
  /** `GET /admin/riders` - active riders only (the API filters), no
   * availability flag exists (mirrors Admin's own `riders.listActive`).
   * Widened from a `{id}`-only row to the full `RiderOption` shape by task
   * F3 (the assign-rider dialog needs name/phone/vehicle/open-deliveries);
   * Home (F2) only ever read `.length`, so this is a compatible superset,
   * not a breaking change. */
  listActive: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders').then((d) => d.riders),

  /** `GET /admin/riders?include_inactive=true` - every rider profile, inactive
   * ones too (each row's `is_active` says which): the cash hand-in picker,
   * since a rider switched off may still owe cash. */
  listForCash: () =>
    apiRequest<{ riders: RiderOption[] }>('/admin/riders', { query: { include_inactive: 'true' } }).then((d) => d.riders),

  /** `GET /admin/riders/suggestions?order_id=` - the same riders, best first
   * for this order (load, distance to the store, the trip they are on). */
  suggestions: (orderId: string) =>
    apiRequest<RiderSuggestions>(`/admin/riders/suggestions?order_id=${encodeURIComponent(orderId)}`),

  /**
   * `GET /riders/deliveries` - the signed-in operator's own linked rider
   * profile's deliveries, if any. Only meaningful when `AuthContext`'s
   * `riderCapability` is `ADMIN_PLUS_RIDER`; a 403
   * `RIDER_PROFILE_NOT_FOUND`/`RIDER_INACTIVE` means there is nothing to
   * show, not a real error (see `auth/riderProbe.ts`). The rider identity is
   * always resolved server-side from the bearer token - no rider id is ever
   * sent by this call (common.md rule 4). This is the same endpoint
   * `riderProbe.ts` calls directly (per F1's report §2, a deliberate
   * exception it flagged for this task to revisit) - not refactored to
   * share code here, since the probe only needs success/failure while this
   * needs the parsed list; both stay simple as they are.
   */
  myDeliveries: () => apiRequest<{ deliveries: MyDelivery[] }>('/riders/deliveries').then((d) => d.deliveries),

  /** `GET /admin/riders/:id/pay` - company or commission, and the % (owner, 2026-10-09). */
  pay: (id: string) => apiRequest<{ pay: RiderPay }>(`/admin/riders/${id}/pay`).then((d) => d.pay),

  /** `PATCH /admin/riders/:id/pay` - `commission_percent` null = store default. */
  updatePay: (id: string, input: RiderPayInput) =>
    apiRequest<{ pay: RiderPay }>(`/admin/riders/${id}/pay`, { method: 'PATCH', body: { ...input } }).then((d) => d.pay),

  /** `GET /admin/reports/rider-earnings` - per rider delivery share and margin. `from`/`to` only for custom. */
  earnings: (range: EarningsRange, from?: string, to?: string) =>
    apiRequest<RiderEarningsReport>('/admin/reports/rider-earnings', {
      query: range === 'custom' ? { range, from: from ?? '', to: to ?? '' } : { range },
    }),
};

// ---------------------------------------------------------------- delivery
// Task F4 (Delivery Mode/live location, plan §11/§21). The exact rider
// delivery endpoints (apps/rider/src/api/resources.ts's own `deliveriesApi`,
// ported not imported - common.md rule 2), reachable by this ADMIN+linked-
// rider operator only because B1 widened their route guards - see
// task-B1-report.md. Rider identity is always resolved server-side from the
// bearer token (`findRiderByUserId`) - no rider id is ever read from any
// call below, and none of these functions accept one (common.md rule 4, the
// single most important invariant in this task). Distinct from
// `riders.myDeliveries()` above (F2's minimal `MyDelivery[]` for Home's
// card): this block returns the full `DeliverySummary`/`DeliveryDetail`
// shape Queue/Detail need to run `lib/delivery.ts`'s ported state-machine
// rules - both call the same `GET /riders/deliveries`, left as two call
// sites for the same reason F2's report gave for the probe (different
// needs, both stay simple as they are).
export const delivery = {
  list: () => apiRequest<{ deliveries: DeliverySummary[] }>('/riders/deliveries').then((d) => d.deliveries),

  /** "My day": the operator's own delivered / not delivered counts and cash. */
  day: () => apiRequest<RiderDay>('/riders/me/day'),

  /** The operator's own pay today and this week (owner, 2026-10-09). */
  earnings: () => apiRequest<MyEarnings>('/riders/me/earnings'),

  /** The operator's own rider profile (staff riders): null when there is none. */
  profile: () => apiRequest<{ profile: RiderProfile | null }>('/riders/me/profile').then((d) => d.profile),

  /** Sets up (or changes the vehicle on) the operator's own rider profile -
   * active at once. 403 RIDER_PROFILE_DISABLED when an admin switched it off. */
  setUpProfile: (input: RiderProfileInput) =>
    apiRequest<{ profile: RiderProfile }>('/riders/me/profile', { method: 'POST', body: { ...input } }).then(
      (d) => d.profile
    ),

  detail: (id: string) =>
    apiRequest<{ delivery: DeliveryDetail }>(`/riders/deliveries/${id}`).then((d) => d.delivery),

  pickUp: (id: string) => setDeliveryStatus(id, { status: 'PICKED_UP' }),
  arrive: (id: string) => setDeliveryStatus(id, { status: 'ARRIVED_AT_CUSTOMER' }),
  fail: (id: string, reason: string) => setDeliveryStatus(id, { status: 'FAILED', failure_reason: reason }),

  /** `amount` must be the total the API already reported for this delivery -
   * the backend independently re-validates it under its own row lock
   * regardless of what is sent (rider.schema.ts's `collectCodSchema`); this
   * call never decides whether the amount is right, only restates it
   * (common.md rule 8). */
  collectCod: (id: string, amount: number, deliveryCode: string) =>
    apiRequest<{ settlement: CodSettlement }>(`/riders/deliveries/${id}/collect-cod`, {
      method: 'POST',
      // The customer's 4-digit proof-of-delivery code (backend migration 016).
      body: { amount, delivery_code: deliveryCode },
    }).then((d) => d.settlement),

  /** Foreground-only browser Geolocation (common.md rule 10; this task's
   * brief) - no background-location plugin; sends while a delivery is on the
   * road and the app is open on screen (lib/tracker-session.ts). Same
   * payload shape the Rider app's native tracker sends
   * (rider.location.schema.ts: latitude/longitude/accuracy/captured_at). */
  /** In the Android app this goes over native HTTP (api/native-client.ts) so
   * it keeps working with the screen locked; on the web it is plain fetch. */
  sendLocation: (id: string, point: { latitude: number; longitude: number; accuracy: number; captured_at: string }) =>
    isNativeApp()
      ? nativeApiRequest<{ accepted: boolean; reason?: string }>(`/riders/deliveries/${id}/location`, {
          method: 'POST',
          body: point,
        })
      : apiRequest<{ accepted: boolean; reason?: string }>(`/riders/deliveries/${id}/location`, {
          method: 'POST',
          body: point,
        }),
};

function setDeliveryStatus(id: string, body: Record<string, unknown>) {
  return apiRequest<{ delivery: DeliveryDetail }>(`/riders/deliveries/${id}/status`, {
    method: 'PATCH',
    body,
  }).then((d) => d.delivery);
}

// ----------------------------------------------------------------- dental
// Task F8 (Dental clinic management: clinics, doctors, clinic-doctor
// pairings, availability, blocked dates - plan §15-19) added every
// sub-object below `appointments` (F2's). Every path/field verified
// directly against the real backend route table
// (`backend/api/src/modules/dental/index.ts`) and service
// (`dental-admin.service.ts`), not just against task-F8-brief.md's own text
// - see the DEVIATION note on `availability`/`blockedDates` below, the exact
// kind of brief-vs-real-source mismatch F5/F6's own verification discipline
// was carried forward to catch. No hard delete anywhere for
// clinics/doctors/pairings (the backend genuinely has none - `is_active`
// toggle only, preserves appointment-history integrity); availability rows
// and blocked dates are this domain's only two genuine hard deletes
// (configuration, not history - confirmed against
// `dental-admin.service.ts`'s own doc comments on `deleteAvailability`/
// `deleteBlockedDate`).
export const dental = {
  /**
   * `GET /admin/dental/appointments` (list) / `POST .../:id/cancel` (task
   * F9, plan §20-21). F2 (Home) originally defined `appointments` as a
   * single function returning just the array (`{from,to}` only, `limit`
   * fixed at 100, stripped to `.appointments`) - this task widens it into an
   * object, matching the `clinics`/`doctors`/`clinicDoctors` sub-object
   * convention every other function in this block already follows, so
   * `cancel` has a natural home alongside `list`. `list` now carries the
   * full `clinic_id`/`doctor_id`/`status`/`page`/`limit` filter set the
   * Appointments screen needs, and returns the whole `{appointments,
   * pagination}` envelope unstripped (like `inventory.stock.list`/
   * `inventory.ledger.list` below, not the clinics/doctors sub-objects'
   * stripped-array convention) since the screen's own pagination controls
   * need the real `total`/`total_pages`. Home.tsx's two call sites were
   * updated to `dental.appointments.list(...).then((r) => r.appointments)`
   * for the count-only figures they need - a compatible change, not a
   * behavioural one (same query, same response shape underneath).
   * `from`/`to` are calendar dates (`YYYY-MM-DD`, Asia/Colombo), matching
   * the backend's `dateOnlySchema` (dental-admin.schema.ts) - not full ISO
   * instants.
   */
  appointments: {
    list: (params: {
      clinic_id?: string;
      doctor_id?: string;
      status?: DentalAppointmentStatus;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    }) =>
      apiRequest<AdminAppointmentListResult>('/admin/dental/appointments', {
        query: {
          clinic_id: params.clinic_id,
          doctor_id: params.doctor_id,
          status: params.status,
          from: params.from,
          to: params.to,
          page: params.page,
          limit: params.limit,
        },
      }),

    /** B3's admin-cancel endpoint (task-B3-report.md, not a B4/F8 endpoint -
     * confirmed still not duplicated there). Reason is required (server
     * enforces `min(1)`), allowed from `HELD` or `CONFIRMED` only - verified
     * directly against `appointment.service.ts`'s `assertCancellable`
     * (anything except the two terminal cancelled statuses and `EXPIRED`),
     * no ownership restriction, no cutoff. */
    cancel: (id: string, reason: string) =>
      apiRequest<{ appointment: AdminAppointment }>(`/admin/dental/appointments/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      }).then((d) => d.appointment),
  },

  clinics: {
    /** Deliberately unpaginated (confirmed against the real repository, same
     * deviation Admin's own resources.ts documents) - includes inactive
     * clinics unless `isActive` is passed. */
    list: (isActive?: boolean) =>
      apiRequest<{ clinics: DentalClinic[] }>('/admin/dental/clinics', { query: { is_active: isActive } }).then(
        (d) => d.clinics
      ),

    get: (id: string) => apiRequest<{ clinic: DentalClinic }>(`/admin/dental/clinics/${id}`).then((d) => d.clinic),

    create: (input: Record<string, unknown>) =>
      apiRequest<{ clinic: DentalClinic }>('/admin/dental/clinics', { method: 'POST', body: input }).then(
        (d) => d.clinic
      ),

    /** Also the `is_active` toggle - the merge-then-validate
     * `INVALID_CLINIC_HOURS` cross-check runs server-side even on a
     * single-field PATCH (dental-admin.service.ts's own fix-round-1 note). */
    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ clinic: DentalClinic }>(`/admin/dental/clinics/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.clinic
      ),
  },

  doctors: {
    list: (isActive?: boolean) =>
      apiRequest<{ doctors: DentalDoctor[] }>('/admin/dental/doctors', { query: { is_active: isActive } }).then(
        (d) => d.doctors
      ),

    create: (input: Record<string, unknown>) =>
      apiRequest<{ doctor: DentalDoctor }>('/admin/dental/doctors', { method: 'POST', body: input }).then(
        (d) => d.doctor
      ),

    /** Also the `is_active` toggle. */
    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ doctor: DentalDoctor }>(`/admin/dental/doctors/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.doctor
      ),
  },

  /** Doctor ratings (migration 023): a doctor's ratings, hidden ones
   * included, and hiding/unhiding an abusive one. */
  ratings: {
    listForDoctor: (doctorId: string, page = 1) =>
      apiRequest<DoctorRatingsResult>(`/admin/dental/doctors/${doctorId}/ratings`, { query: { page, limit: 50 } }),

    setHidden: (ratingId: string, hidden: boolean) =>
      apiRequest<{ rating: { id: string; is_hidden: boolean; hidden_at: string | null } }>(
        `/admin/dental/ratings/${ratingId}/hidden`,
        { method: 'PATCH', body: { hidden } }
      ).then((d) => d.rating),
  },

  /** The `clinic_doctors` join table - one clinic's doctor roster. */
  clinicDoctors: {
    roster: (clinicId: string) =>
      apiRequest<{ doctors: ClinicDoctorRosterRow[] }>(`/admin/dental/clinics/${clinicId}/doctors`).then(
        (d) => d.doctors
      ),

    /** Rejects with `CLINIC_INACTIVE`/`DOCTOR_INACTIVE`/`CLINIC_NOT_FOUND`/
     * `DOCTOR_NOT_FOUND`/`CLINIC_DOCTOR_PAIRING_EXISTS` (409/404) - every one
     * surfaced verbatim by `lib/dental.ts`'s `dentalErrorMessage`, never a
     * generic failure. */
    attach: (clinicId: string, input: { doctor_id: string; consultation_fee?: number | null }) =>
      apiRequest<{ clinic_doctor: ClinicDoctor }>(`/admin/dental/clinics/${clinicId}/doctors`, {
        method: 'POST',
        body: input,
      }).then((d) => d.clinic_doctor),

    /** Fee/active update - the same `is_active` toggle also powers a
     * pairing's "deactivate/reactivate at this clinic" action. */
    update: (id: string, input: { consultation_fee?: number | null; is_active?: boolean }) =>
      apiRequest<{ clinic_doctor: ClinicDoctor }>(`/admin/dental/clinic-doctors/${id}`, {
        method: 'PATCH',
        body: input,
      }).then((d) => d.clinic_doctor),
  },

  /**
   * Weekly availability template rows for one clinic-doctor pairing.
   *
   * **DEVIATION from task-F8-brief.md's literal endpoint list.** The brief
   * states PATCH/DELETE live at
   * `/admin/dental/clinic-doctors/:id/availability[/:availId]`. The actual
   * registered routes (`backend/api/src/modules/dental/index.ts`) are:
   *   `PATCH /admin/dental/availability/:id`
   *   `DELETE /admin/dental/availability/:id`
   * - NOT nested under `clinic-doctors`. Only POST (create) and GET (list)
   * are nested (`/clinic-doctors/:clinic_doctor_id/availability`). Verified
   * directly against the router file and cross-checked against Admin's own
   * working `resources.ts` (`dentalAvailability.update`/`.remove`), which
   * already calls the un-nested form - this is a real brief error, not a
   * judgment call, corrected here per common.md/F5/F6's verification
   * discipline rather than silently followed.
   */
  availability: {
    list: (clinicDoctorId: string) =>
      apiRequest<{ availability: DoctorAvailability[] }>(
        `/admin/dental/clinic-doctors/${clinicDoctorId}/availability`
      ).then((d) => d.availability),

    /** Rejects with `TEMPLATE_OUTSIDE_CLINIC_HOURS` (400) - the one
     * genuinely cross-entity rule this domain enforces at write time; the
     * backend's own message names both windows, surfaced verbatim. */
    create: (clinicDoctorId: string, input: Record<string, unknown>) =>
      apiRequest<{ availability: DoctorAvailability }>(
        `/admin/dental/clinic-doctors/${clinicDoctorId}/availability`,
        { method: 'POST', body: input }
      ).then((d) => d.availability),

    /** NOT nested under `clinic-doctors` - see this block's deviation note. */
    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ availability: DoctorAvailability }>(`/admin/dental/availability/${id}`, {
        method: 'PATCH',
        body: input,
      }).then((d) => d.availability),

    /** NOT nested under `clinic-doctors` - see this block's deviation note.
     * A hard delete (configuration row, not history - see this block's own
     * doc comment). */
    remove: (id: string) => apiRequest<void>(`/admin/dental/availability/${id}`, { method: 'DELETE' }),
  },

  /** Blocked dates for one clinic-doctor pairing - same nesting deviation as
   * `availability` above (create/list nested under `clinic-doctors`, delete
   * is not). */
  blockedDates: {
    list: (clinicDoctorId: string) =>
      apiRequest<{ blocked_dates: DoctorBlockedDate[] }>(
        `/admin/dental/clinic-doctors/${clinicDoctorId}/blocked-dates`
      ).then((d) => d.blocked_dates),

    /** Rejects with `BLOCKED_DATE_EXISTS` (409) on a duplicate date for this
     * pairing, surfaced verbatim. */
    create: (clinicDoctorId: string, input: { blocked_date: string; reason: string }) =>
      apiRequest<{ blocked_date: DoctorBlockedDate }>(
        `/admin/dental/clinic-doctors/${clinicDoctorId}/blocked-dates`,
        { method: 'POST', body: input }
      ).then((d) => d.blocked_date),

    /** NOT nested under `clinic-doctors` (see `availability`'s deviation
     * note - the same shape). "Unblocking" a date is this hard delete. */
    remove: (id: string) => apiRequest<void>(`/admin/dental/blocked-dates/${id}`, { method: 'DELETE' }),
  },
};

// ---------------------------------------------------------------- catalog
// Task F5 (Catalog: products, categories, promotions, plan §12). Every
// function below reuses an endpoint Admin already calls (verified directly
// against `backend/api/src/modules/catalog/index.ts` and
// `backend/api/src/modules/promotions/index.ts`, both already ADMIN-gated -
// zero backend change needed, matching common.md's OPS-04 decision).
//
// **Products list endpoint - a deliberate departure from the brief's literal
// wording.** The brief names `GET /catalog/products` ("the only paginated
// product listing the backend exposes, per Admin's own code comment"). That
// comment (`apps/admin/src/api/resources.ts`) is stale: Admin's own
// `Products.tsx` page does not call it - it calls `GET /admin/products`
// directly, which is *also* paginated (`catalogController.listProductsAdmin`,
// verified by reading `catalog.controller.ts`/`catalog.schema.ts`), is
// ADMIN-gated, and - unlike the customer endpoint - returns the fields the
// admin table actually needs (`is_active`, `purchase_cost`,
// `calculated_selling_price`, filterable by `category_id`/`is_active`). The
// customer endpoint has no `is_active` concept at all (it only ever lists
// active, available products), so building Products' "show inactive too"
// requirement (matching Admin's own page description) against it would be
// impossible. `products.list()` below therefore calls `/admin/products`,
// exactly like Admin's real page does - not the resources.ts comment.
// `products.listPublic()` still wraps `GET /catalog/products` (the brief's
// named endpoint, kept available) since Admin's own resources.ts defines the
// identical function and never calls it either - not wired into any screen,
// documented rather than silently dropped.
/** `GET /admin/products` serves at most 200 rows a page (catalog.service.ts). */
export const PRODUCT_PAGE_LIMIT = 200;
/** 25 pages = 5,000 products: far beyond today's catalog, still a bounded load. */
export const PRODUCT_PAGE_CAP = 25;

export const catalog = {
  categories: {
    list: (isActive?: boolean) =>
      apiRequest<{ categories: Category[] }>('/admin/categories', {
        query: { is_active: isActive },
      }).then((d) => d.categories),

    create: (input: Record<string, unknown>) =>
      apiRequest<{ category: Category }>('/admin/categories', { method: 'POST', body: input }).then(
        (d) => d.category
      ),

    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ category: Category }>(`/admin/categories/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.category
      ),

    /** `DELETE /admin/categories/:id` - a category with products needs a
     * `move_to_category_id` target (sent as a query param, per the contract)
     * or the server answers 409 `CATEGORY_NOT_EMPTY` with `product_count`. */
    remove: (id: string, moveToCategoryId?: string) =>
      apiRequest<CategoryDeleteResult>(`/admin/categories/${id}`, {
        method: 'DELETE',
        query: { move_to_category_id: moveToCategoryId },
      }),

    /** Category offer (migration 033; owner, 2026-10-09): % off everything in
     * the category and its sub-categories. PUT replaces any existing offer;
     * a left-out/null `offer_ends_at` means no end. */
    setOffer: (id: string, body: { offer_percent: number; offer_ends_at: string | null }) =>
      apiRequest<{ category: Category }>(`/admin/categories/${id}/offer`, { method: 'PUT', body }).then((d) => d.category),

    removeOffer: (id: string) =>
      apiRequest<{ category: Category }>(`/admin/categories/${id}/offer`, { method: 'DELETE' }).then((d) => d.category),
  },

  /** Combo packs (migration 033; owner, 2026-10-09). PATCH `items`, when
   * sent, replaces the whole list. Delete is a soft delete on the server. */
  combos: {
    list: () => apiRequest<{ combos: Combo[] }>('/admin/combos').then((d) => d.combos),

    create: (input: ComboInput) =>
      apiRequest<{ combo: Combo }>('/admin/combos', { method: 'POST', body: input }).then((d) => d.combo),

    update: (id: string, input: Partial<ComboInput>) =>
      apiRequest<{ combo: Combo }>(`/admin/combos/${id}`, { method: 'PATCH', body: input }).then((d) => d.combo),

    remove: (id: string) => apiRequest<{ id: string; deleted: boolean }>(`/admin/combos/${id}`, { method: 'DELETE' }),
  },

  /** Category groups: the titled rows of category tiles on the customer
   * Home (`/admin/category-groups`, ADMIN and OPERATIONS). */
  categoryGroups: {
    list: () => apiRequest<CategoryGroupsOverview>('/admin/category-groups'),

    create: (input: { name: string; is_active?: boolean }) =>
      apiRequest<{ group: CategoryGroup }>('/admin/category-groups', { method: 'POST', body: input }).then((d) => d.group),

    update: (id: string, input: { name?: string; is_active?: boolean }) =>
      apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.group
      ),

    remove: (id: string) =>
      apiRequest<CategoryGroupDeleteResult>(`/admin/category-groups/${id}`, { method: 'DELETE' }),

    /** Must list every live group exactly once (400 otherwise). */
    reorder: (groupIds: string[]) =>
      apiRequest<{ groups: CategoryGroup[] }>('/admin/category-groups/order', {
        method: 'PUT',
        body: { group_ids: groupIds },
      }).then((d) => d.groups),

    /** Sets the group's exact membership AND order; members left out become
     * unassigned, listed categories from another group move in. */
    setCategories: (id: string, categoryIds: string[]) =>
      apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}/categories`, {
        method: 'PUT',
        body: { category_ids: categoryIds },
      }).then((d) => d.group),
  },

  products: {
    /** `GET /admin/products` - see the doc comment above for why this is
     * used instead of the brief's literally-named customer endpoint. */
    list: (params: { search?: string; category_id?: string; is_active?: boolean; limit?: number } = {}) =>
      apiRequest<{ products: AdminProduct[]; pagination: unknown }>('/admin/products', {
        query: { search: params.search, category_id: params.category_id, is_active: params.is_active, limit: params.limit ?? 200 },
      }).then((d) => d.products),

    /**
     * EVERY product matching the filters. `GET /admin/products` returns at
     * most 200 rows a page and no total, so this reads page after page until
     * one comes back short. Stops at PRODUCT_PAGE_CAP pages and says so
     * (`capped`) rather than loading forever - the screen shows a notice.
     */
    listAll: async (
      params: { search?: string; category_id?: string; is_active?: boolean } = {}
    ): Promise<{ products: AdminProduct[]; capped: boolean }> => {
      const products: AdminProduct[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= PRODUCT_PAGE_CAP; page++) {
        const rows = await apiRequest<{ products: AdminProduct[] }>('/admin/products', {
          query: { ...params, limit: PRODUCT_PAGE_LIMIT, page },
        }).then((d) => d.products);
        const fresh = rows.filter((p) => !seen.has(p.id));
        for (const p of fresh) seen.add(p.id);
        products.push(...fresh);
        // A short page is the last one; a page of nothing new means the API
        // ignored `page` - either way there is nothing more to read.
        if (rows.length < PRODUCT_PAGE_LIMIT || fresh.length === 0) return { products, capped: false };
      }
      return { products, capped: true };
    },

    getAdmin: (id: string) => apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`).then((d) => d.product),

    create: (input: Record<string, unknown>) =>
      apiRequest<{ product: AdminProduct }>('/admin/products', { method: 'POST', body: input }).then((d) => d.product),

    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.product
      ),

    /** `DELETE /admin/products/:id` - HARD or SOFT, decided by the server. */
    remove: (id: string) => apiRequest<ProductDeleteResult>(`/admin/products/${id}`, { method: 'DELETE' }),

    /** `POST /admin/products/import` - rows parsed in the browser
     * (lib/productImport.ts). `dry_run` validates without writing. */
    import: (rows: ImportRow[], dryRun: boolean) =>
      apiRequest<ImportResult>('/admin/products/import', { method: 'POST', body: { rows, dry_run: dryRun } }),

    /** `GET /catalog/products` (customer-facing, paginated) - the endpoint
     * named in the brief. Defined for completeness (mirrors Admin's own
     * unused `listCustomerView`) but not called by any Operations screen -
     * see the block's doc comment. */
    listPublic: (params: { search?: string; category_slug?: string; limit?: number; page?: number } = {}) =>
      apiRequest<Paginated<CustomerProduct>>('/catalog/products', {
        auth: false,
        query: { search: params.search, category_slug: params.category_slug, limit: params.limit ?? 100, page: params.page ?? 1 },
      }),
  },

  promotions: {
    list: (isActive?: boolean) =>
      apiRequest<{ promotions: Promotion[] }>('/admin/promotions', { query: { is_active: isActive } }).then(
        (d) => d.promotions
      ),

    create: (input: Record<string, unknown>) =>
      apiRequest<{ promotion: Promotion }>('/admin/promotions', { method: 'POST', body: input }).then(
        (d) => d.promotion
      ),

    update: (id: string, input: Record<string, unknown>) =>
      apiRequest<{ promotion: Promotion }>(`/admin/promotions/${id}`, { method: 'PATCH', body: input }).then(
        (d) => d.promotion
      ),

    reorder: (items: { id: string; display_order: number }[]) =>
      apiRequest<{ promotions: Promotion[] }>('/admin/promotions/reorder', {
        method: 'PATCH',
        body: { items },
      }).then((d) => d.promotions),

    remove: (id: string) => apiRequest(`/admin/promotions/${id}`, { method: 'DELETE' }),

    /** `GET /promotions` (public) - the exact payload the customer Home
     * carousel receives right now, used by the Promotions screen's "What
     * customers see" preview strip (real data, not the per-row editing
     * draft `PromotionPreview` also renders). */
    listPublic: () =>
      apiRequest<{ promotions: Promotion[] }>('/promotions', { auth: false }).then((d) => d.promotions),
  },
};

// -------------------------------------------------------------- inventory
// Task F6 (Inventory: stock, ledger, sourcing, suppliers, plan §13,
// common.md's OPS-04 scope decision). Every function below reuses an
// endpoint Inventory already calls (verified directly against
// `backend/api/src/modules/admin/index.ts`'s route table, the same
// verification discipline F3/F5 each applied to their own domains) - all
// already reachable by this ADMIN-role operator with zero backend change:
// every read below is `requireRoles(['ADMIN','PACKING_STAFF'])`, every write
// (`setMode`/`adjust`/`suppliers.create`/`suppliers.update`) is
// `requireRoles('ADMIN')` alone. Unlike Inventory's own `resources.ts`
// (`stockApi`/`ledgerApi`/`sourcingApi`/`suppliersApi`, four separate
// exports), this follows Operations' own one-domain-block convention (see
// this file's own doc comment) - one `inventory` object with
// `stock`/`ledger`/`sourcing`/`suppliers` sub-objects, mirroring `catalog`'s
// own `categories`/`products`/`promotions` shape (F5).
export interface StockQuery {
  search?: string;
  tracking_mode?: TrackingMode;
  low_stock_only?: boolean;
  include_inactive?: boolean;
  limit?: number;
}

export interface LedgerQuery {
  product_id?: string;
  type?: AdjustmentType;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/**
 * Order statuses that can still have items waiting to be sourced (mirrors
 * Inventory's own `SOURCEABLE_STATUSES` - the same two statuses
 * `orders.needingPacking()` above already queries for, see its doc comment).
 * Resolving an item as unavailable moves the whole order to
 * `ITEM_UNAVAILABLE`, and its other items may still need sourcing, so both
 * statuses feed the queue.
 */
export const inventory = {
  stock: {
    list: (query: StockQuery = {}) =>
      apiRequest<{ inventory: StockRow[]; pagination: Pagination }>('/admin/inventory', { query: { ...query } }),

    /**
     * Every row matching the query, read 100 at a time (the API's page
     * limit; asking for more is refused with a 400).
     */
    listAll: async (query: Omit<StockQuery, 'page' | 'limit'> = {}): Promise<StockRow[]> => {
      const rows: StockRow[] = [];
      for (let page = 1; ; page++) {
        const result = await apiRequest<{ inventory: StockRow[]; pagination: Pagination }>('/admin/inventory', {
          query: { ...query, page, limit: 100 },
        });
        rows.push(...result.inventory);
        if (page >= result.pagination.total_pages || result.inventory.length === 0) return rows;
      }
    },

    detail: (productId: string) => apiRequest<StockDetail>(`/admin/inventory/${productId}`),

    setMode: (productId: string, tracking_mode: TrackingMode) =>
      apiRequest(`/admin/inventory/${productId}/mode`, { method: 'PATCH', body: { tracking_mode } }),

    adjust: (
      productId: string,
      body: { adjustment_type: ManualAdjustmentType; quantity_delta: number; notes: string }
    ) =>
      apiRequest<{ inventory: { quantity_on_hand: number; quantity_available: number } }>(
        `/admin/inventory/${productId}/adjust`,
        { method: 'POST', body }
      ),

    /** `PATCH /admin/inventory/:productId/threshold` - TRACKED products only
     * (409 `PRODUCT_NOT_TRACKED` otherwise). */
    setThreshold: (productId: string, low_stock_threshold: number) =>
      apiRequest(`/admin/inventory/${productId}/threshold`, { method: 'PATCH', body: { low_stock_threshold } }),

    /** `GET /admin/inventory/low-stock` - tracked products at or under their
     * threshold, OUT first. */
    lowStock: () => apiRequest<LowStockResult>('/admin/inventory/low-stock'),
  },

  ledger: {
    list: (query: LedgerQuery = {}) =>
      apiRequest<{ adjustments: LedgerEntry[]; pagination: Pagination }>('/admin/inventory/adjustments', {
        query: { ...query },
      }),
  },

  suppliers: {
    list: (activeOnly: boolean) =>
      apiRequest<{ suppliers: Supplier[] }>('/admin/suppliers', {
        query: { active_only: String(activeOnly) },
      }).then((d) => d.suppliers),

    create: (body: SupplierInput) =>
      apiRequest<{ supplier: Supplier }>('/admin/suppliers', { method: 'POST', body: { ...body } }).then(
        (d) => d.supplier
      ),

    update: (id: string, body: SupplierInput) =>
      apiRequest<{ supplier: Supplier }>(`/admin/suppliers/${id}`, { method: 'PATCH', body: { ...body } }).then(
        (d) => d.supplier
      ),
  },
};

// --------------------------------------------------------------- settings
/** Store-wide settings Operations can change (ADMIN, OPERATIONS). */
export const settings = {
  deliveryFee: {
    get: () => apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee'),
    update: (fee_lkr: number) =>
      apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee', { method: 'PATCH', body: { fee_lkr } }),
  },
  /** Coupon codes on/off (owner, 2026-10-08) and free deliveries for every
   * customer since a start date (owner, 2026-10-09). `since` is optional on
   * PATCH: left out, the stored start date stays. */
  checkout: {
    get: () => apiRequest<CheckoutSettings>('/admin/settings/checkout'),
    update: (body: {
      coupons_enabled?: boolean;
      new_customer_free_deliveries?: { enabled: boolean; count: number; since?: string };
    }) =>
      apiRequest<CheckoutSettings>('/admin/settings/checkout', { method: 'PATCH', body }),
  },
  /** The % of the standard delivery fee a commission rider earns, unless
   * they have their own (owner, 2026-10-09). */
  riderCommission: {
    get: () => apiRequest<RiderCommissionSetting>('/admin/settings/rider-commission'),
    update: (default_percent: number) =>
      apiRequest<RiderCommissionSetting>('/admin/settings/rider-commission', { method: 'PATCH', body: { default_percent } }),
  },
  /** Birthday offer: X% off one order in the birthday week, plus a birthday
   * SMS (owner, 2026-10-09). PATCH sends only what changed. */
  birthdayOffer: {
    get: () => apiRequest<BirthdayOfferSetting>('/admin/settings/birthday-offer'),
    update: (body: BirthdayOfferInput) =>
      apiRequest<BirthdayOfferSetting>('/admin/settings/birthday-offer', { method: 'PATCH', body: { ...body } }),
  },
  /** Customers whose birthday week is now or within `days` days. */
  birthdays: (days = 7) =>
    apiRequest<BirthdaysResult>('/admin/birthdays', { query: { days: String(days) } }),
};

// ------------------------------------------------------------------ staff
/**
 * Staff accounts (More -> Staff accounts). ADMIN and OPERATIONS; which roles
 * each may create or change is the backend's permission matrix.
 */
export const staff = {
  list: () => apiRequest<{ staff: StaffAccount[] }>('/admin/staff').then((d) => d.staff),

  create: (input: CreateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>('/admin/staff', { method: 'POST', body: { ...input } }).then((d) => d.staff),

  update: (id: string, input: UpdateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>(`/admin/staff/${id}`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.staff
    ),
};

// -------------------------------------------------------------------- cash
/**
 * Rider cash hand-ins and the daily reconciliation (backend migration 019).
 * ADMIN and OPERATIONS; deleting a hand-in is ADMIN only.
 */
export const cash = {
  reconciliation: (date: string) => apiRequest<CashReconciliation>(`/admin/cash/reconciliation?date=${date}`),

  handins: (date: string) =>
    apiRequest<{ handins: CashHandin[] }>(`/admin/cash/handins?date=${date}`).then((d) => d.handins),

  record: (input: { rider_id: string; amount: number; handin_date: string; note?: string }) =>
    apiRequest<{ handin: CashHandin }>('/admin/cash/handins', { method: 'POST', body: { ...input } }).then(
      (d) => d.handin
    ),

  remove: (id: string) => apiRequest(`/admin/cash/handins/${id}`, { method: 'DELETE' }),
};

// -------------------------------------------------------------- sms offers
/**
 * Offer SMS to registered customers (More -> SMS offers). ADMIN and
 * OPERATIONS. The backend picks each customer's language, skips those who
 * turned offers off, appends the opt-out line and enforces 8 AM - 9 PM.
 */
export const smsOffers = {
  list: () => apiRequest<{ offers: SmsOffer[] }>('/admin/sms-offers').then((d) => d.offers),

  estimate: (input: SmsOfferInput) =>
    apiRequest<{ estimate: SmsOfferEstimate }>('/admin/sms-offers/estimate', { method: 'POST', body: { ...input } }).then(
      (d) => d.estimate
    ),

  send: (input: SmsOfferInput) =>
    apiRequest<{ offer: SmsOfferCreated }>('/admin/sms-offers', { method: 'POST', body: { ...input } }).then(
      (d) => d.offer
    ),

  /**
   * Sends one test text to `phone` (a Sri Lankan mobile) or, when it is
   * left out, to the signed-in staff member's own phone.
   */
  test: (language: SmsLanguage, message: string, phone?: string) =>
    apiRequest<SmsOfferTestResult>('/admin/sms-offers/test', {
      method: 'POST',
      body: { language, message, ...(phone ? { phone } : {}) },
    }),
};

/** Rider applications from the Rider app: Admin and Operations approve or reject. */
export const riderApplications = {
  list: (status: RiderApprovalStatus, page = 1, limit = 50) =>
    apiRequest<RiderApplicationPage>(`/admin/rider-applications?status=${status}&page=${page}&limit=${limit}`),
  pendingCount: () => apiRequest<{ pending: number }>('/admin/rider-applications/count').then((d) => d.pending),
  /** Without `pay` the rider becomes COMPANY (owner, 2026-10-09). */
  approve: (id: string, pay?: RiderPayInput) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/approve`, {
      method: 'POST',
      ...(pay ? { body: { ...pay } } : {}),
    }).then((d) => d.application),
  reject: (id: string, reason: string) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }).then((d) => d.application),
};
