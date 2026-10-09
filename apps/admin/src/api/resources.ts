import { apiRequest, tokenStore } from './client';
import type {
  DentalDoctor,
  DentalDoctorInput,
  BoardOrder,
  OrderDetail,
  RiderOption,
  RiderSuggestions,
  AdminProduct,
  AuthUser,
  Category,
  CategoryDeleteResult,
  CategoryGroup,
  CategoryGroupDeleteResult,
  CategoryGroupsOverview,
  CustomerProduct,
  DeliveryFeeSetting,
  CheckoutSettings,
  ImportResponse,
  ImportRow,
  ProductDeleteResult,
  FeedbackPage,
  FeedbackStatus,
  Paginated,
  Promotion,
  StaffAccount,
  CreateStaffInput,
  UpdateStaffInput,
  StaffRider,
  StaffRiderInput,
  CashHandin,
  CashReconciliation,
  Coupon,
  CouponInput,
  CustomerDetail,
  CustomerExportRow,
  CustomerRow,
  CustomerSort,
  SalesRange,
  SalesReport,
  SmsLanguage,
  SmsOffer,
  SmsOfferEstimate,
  SmsOfferInput,
  SmsOfferSent,
  SmsOfferTestResult,
  RiderApplication,
  RiderApplicationPage,
  RiderApprovalStatus,
} from './types';

/**
 * Typed wrappers over the existing Blynk endpoints. No endpoint is invented
 * here: admin catalog routes already existed, promotions and media were
 * added in this phase.
 */

// ---------------------------------------------------------------- auth
export const auth = {
  /** Staff email + password sign-in (backend migration 012). */
  staffLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  me: () => apiRequest<AuthUser>('/auth/me'),

  // Send the refresh token so the server revokes it: without it the route
  // knows neither the session nor the user, and the session outlives sign-out.
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', body: tokenStore.refresh ? { refresh_token: tokenStore.refresh } : {} }),
};

// ------------------------------------------------------------ categories
export const categories = {
  listAdmin: (isActive?: boolean) =>
    apiRequest<{ categories: Category[] }>(
      `/admin/categories${isActive === undefined ? '' : `?is_active=${isActive}`}`
    ).then((data) => data.categories),

  create: (input: Partial<Category>) =>
    apiRequest<{ category: Category }>('/admin/categories', {
      method: 'POST',
      body: input as Record<string, unknown>,
    }).then((data) => data.category),

  update: (id: string, input: Partial<Category>) =>
    apiRequest<{ category: Category }>(`/admin/categories/${id}`, {
      method: 'PATCH',
      body: input as Record<string, unknown>,
    }).then((data) => data.category),

  /**
   * A category with products needs a target: 409 CATEGORY_NOT_EMPTY
   * (details.product_count) otherwise. The target goes as a query param.
   */
  remove: (id: string, moveToCategoryId?: string) =>
    apiRequest<CategoryDeleteResult>(
      `/admin/categories/${id}${
        moveToCategoryId ? `?move_to_category_id=${encodeURIComponent(moveToCategoryId)}` : ''
      }`,
      { method: 'DELETE' }
    ),
};

// ------------------------------------------------------- category groups
/** The titled rows of category tiles on the customer Home. */
export const categoryGroups = {
  list: () => apiRequest<CategoryGroupsOverview>('/admin/category-groups'),

  create: (input: { name: string; is_active?: boolean }) =>
    apiRequest<{ group: CategoryGroup }>('/admin/category-groups', {
      method: 'POST',
      body: input,
    }).then((data) => data.group),

  update: (id: string, input: { name?: string; is_active?: boolean }) =>
    apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.group),

  remove: (id: string) =>
    apiRequest<CategoryGroupDeleteResult>(`/admin/category-groups/${id}`, { method: 'DELETE' }),

  /** Must list every live group exactly once (400 otherwise). */
  reorder: (groupIds: string[]) =>
    apiRequest<{ groups: CategoryGroup[] }>('/admin/category-groups/order', {
      method: 'PUT',
      body: { group_ids: groupIds },
    }).then((data) => data.groups),

  /**
   * Sets the group's exact membership AND order: members left out become
   * unassigned; listed categories from another group move in.
   */
  setCategories: (id: string, categoryIds: string[]) =>
    apiRequest<{ group: CategoryGroup }>(`/admin/category-groups/${id}/categories`, {
      method: 'PUT',
      body: { category_ids: categoryIds },
    }).then((data) => data.group),
};

// -------------------------------------------------------------- products
/** The API's largest page of admin products. */
export const PRODUCT_PAGE_SIZE = 200;
/** 50 pages = 10,000 products; past that the list says it is partial. */
export const MAX_PRODUCT_PAGES = 50;

export const products = {
  /**
   * The admin product table reads the customer catalog endpoint for the
   * list (it is the only paginated product listing the backend exposes) and
   * the admin endpoint for a single product's cost/markup fields.
   * `is_available=false` is passed through so inactive-but-available rows
   * are not silently hidden from operators.
   */
  listCustomerView: (params: {
    search?: string;
    category_slug?: string;
    limit?: number;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.category_slug) query.set('category_slug', params.category_slug);
    query.set('limit', String(params.limit ?? 100));
    query.set('page', String(params.page ?? 1));
    return apiRequest<Paginated<CustomerProduct>>(
      `/catalog/products?${query.toString()}`,
      { auth: false }
    );
  },

  /**
   * Every admin product matching the filters. GET /admin/products returns
   * one page (at most 200) and no total, so this reads page after page until
   * a short page. `complete` is false only if MAX_PRODUCT_PAGES were read and
   * more may remain - the caller says so rather than capping silently.
   */
  listAllAdmin: async (params: { search?: string; category_id?: string; is_active?: boolean } = {}) => {
    const all: AdminProduct[] = [];
    for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.category_id) query.set('category_id', params.category_id);
      if (params.is_active !== undefined) query.set('is_active', String(params.is_active));
      query.set('limit', String(PRODUCT_PAGE_SIZE));
      query.set('page', String(page));
      const data = await apiRequest<{ products: AdminProduct[] }>(`/admin/products?${query.toString()}`);
      all.push(...data.products);
      if (data.products.length < PRODUCT_PAGE_SIZE) return { products: all, complete: true };
    }
    return { products: all, complete: false };
  },

  getAdmin: (id: string) =>
    apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`).then(
      (data) => data.product
    ),

  create: (input: Record<string, unknown>) =>
    apiRequest<{ product: AdminProduct }>('/admin/products', {
      method: 'POST',
      body: input,
    }).then((data) => data.product),

  update: (id: string, input: Record<string, unknown>) =>
    apiRequest<{ product: AdminProduct }>(`/admin/products/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.product),

  /** Hard-deletes a never-ordered product; hides (soft-deletes) one with order history. */
  remove: (id: string) => apiRequest<ProductDeleteResult>(`/admin/products/${id}`, { method: 'DELETE' }),

  /** Rows parsed in the browser; dry_run validates against the DB without writing. */
  importRows: (rows: ImportRow[], dryRun: boolean) =>
    apiRequest<ImportResponse>('/admin/products/import', {
      method: 'POST',
      body: { rows, dry_run: dryRun },
    }),
};

// -------------------------------------------------------------- settings
export const settings = {
  getDeliveryFee: () => apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee'),

  setDeliveryFee: (feeLkr: number) =>
    apiRequest<DeliveryFeeSetting>('/admin/settings/delivery-fee', {
      method: 'PATCH',
      body: { fee_lkr: feeLkr },
    }),

  getCheckout: () => apiRequest<CheckoutSettings>('/admin/settings/checkout'),

  /** `since` is optional: omitted keeps the stored start (owner, 2026-10-09). */
  setCheckout: (body: {
    coupons_enabled?: boolean;
    new_customer_free_deliveries?: { enabled: boolean; count: number; since?: string };
  }) =>
    apiRequest<CheckoutSettings>('/admin/settings/checkout', { method: 'PATCH', body }),
};

// ------------------------------------------------------------ promotions
export const promotions = {
  listAdmin: (isActive?: boolean) =>
    apiRequest<{ promotions: Promotion[] }>(
      `/admin/promotions${isActive === undefined ? '' : `?is_active=${isActive}`}`
    ).then((data) => data.promotions),

  create: (input: Record<string, unknown>) =>
    apiRequest<{ promotion: Promotion }>('/admin/promotions', {
      method: 'POST',
      body: input,
    }).then((data) => data.promotion),

  update: (id: string, input: Record<string, unknown>) =>
    apiRequest<{ promotion: Promotion }>(`/admin/promotions/${id}`, {
      method: 'PATCH',
      body: input,
    }).then((data) => data.promotion),

  reorder: (items: { id: string; display_order: number }[]) =>
    apiRequest<{ promotions: Promotion[] }>('/admin/promotions/reorder', {
      method: 'PATCH',
      body: { items },
    }).then((data) => data.promotions),

  remove: (id: string) =>
    apiRequest(`/admin/promotions/${id}`, { method: 'DELETE' }),

  /** The exact payload the customer Home carousel receives. */
  listCustomerView: () =>
    apiRequest<{ promotions: Promotion[] }>('/promotions', { auth: false }).then(
      (data) => data.promotions
    ),
};

// ---------------------------------------------------------------- orders
/** Lanes the Orders board shows (every live and exception state). */
const LIVE_STATUSES = 'PLACED,ITEM_UNAVAILABLE,PACKED,OUT_FOR_DELIVERY,FAILED,CUSTOMER_UNAVAILABLE';

/**
 * Order operations over the existing routes. Each status change is one
 * lifecycle action decided by the API (PATCH /admin/orders/:id/status).
 */
/** The page size the board reads live orders in (the API caps limit at 100). */
export const LIVE_ORDERS_LIMIT = 100;
/** The most pages the board reads in one load (2,000 live orders); past that it says so. */
export const LIVE_ORDERS_MAX_PAGES = 20;

type OrdersPage = { orders: BoardOrder[]; pagination?: { total?: number; total_pages?: number } };

export const orders = {
  /**
   * Every live order, oldest first: the pages are read in sequence until
   * pagination.total_pages (at most LIVE_ORDERS_MAX_PAGES). `total` is the
   * API's count; `truncated` is true only when that bound stopped the read.
   * An order that moved between page reads is kept once.
   */
  live: async () => {
    const read = (page: number) =>
      apiRequest<OrdersPage>(`/admin/orders?status=${LIVE_STATUSES}&limit=${LIVE_ORDERS_LIMIT}&page=${page}`);
    const first = await read(1);
    const total = first.pagination?.total ?? first.orders.length;
    const totalPages = first.pagination?.total_pages ?? 1;
    const all = [...first.orders];
    const last = Math.min(totalPages, LIVE_ORDERS_MAX_PAGES);
    for (let page = 2; page <= last; page += 1) {
      const next = await read(page);
      all.push(...next.orders);
      if (next.orders.length < LIVE_ORDERS_LIMIT) break;
    }
    const seen = new Set<string>();
    const unique = all.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    return { orders: unique, total, truncated: totalPages > LIVE_ORDERS_MAX_PAGES };
  },

  /**
   * How many orders reached `status` since `since` - pagination.total, so the
   * count is right however many there are (one row is fetched, not all).
   */
  countSince: (status: 'DELIVERED' | 'CANCELLED', since: Date) =>
    apiRequest<OrdersPage>(
      `/admin/orders?status=${status}&since=${encodeURIComponent(since.toISOString())}&limit=1`
    ).then((d) => d.pagination?.total ?? d.orders.length),

  detail: (id: string) => apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}`).then((d) => d.order),

  setStatus: (id: string, status: string, notes?: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: notes === undefined ? { status } : { status, notes },
    }),

  /**
   * Proof of delivery: the customer's 4-digit code, or - only when there is
   * no code - a written override note. The history records which one it was.
   */
  markDelivered: (id: string, proof: { deliveryCode: string } | { notes: string }) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body:
        'deliveryCode' in proof
          ? { status: 'DELIVERED', delivery_code: proof.deliveryCode }
          : { status: 'DELIVERED', notes: proof.notes },
    }),

  /** A pending item the store cannot supply (lifecycle RESOLVE_ITEM). */
  markItemUnavailable: (id: string, itemId: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/resolve-item`, {
      method: 'POST',
      body: { item_id: itemId, item_status: 'UNAVAILABLE' },
    }),

  assignRider: (id: string, riderId: string, confirmFarBatch = false) =>
    apiRequest<{ delivery: unknown }>(`/admin/orders/${id}/assign-rider`, {
      method: 'POST',
      // The operator saw that this drop-off is far from the rider's other one.
      body: confirmFarBatch ? { rider_id: riderId, confirm_far_batch: true } : { rider_id: riderId },
    }),
};

export const riders = {
  /** Active riders only (the API filters); no availability flag exists. */
  listActive: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders').then((d) => d.riders),
  /**
   * Every rider profile, inactive ones too (each row's `is_active` says
   * which) - the cash hand-in picker, since a rider switched off may still
   * owe cash.
   */
  listForCash: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders?include_inactive=true').then((d) => d.riders),
  /** The same riders, best first for one order (load, distance to the store, trip). */
  suggestions: (orderId: string) =>
    apiRequest<RiderSuggestions>(`/admin/riders/suggestions?order_id=${encodeURIComponent(orderId)}`),
};

// -------------------------------------------------------------- feedback
/** Customer feedback sent from the app (backend migration 013). ADMIN only. */
export const feedback = {
  /** Newest first; `status` omitted means every message. */
  list: (params: { status?: FeedbackStatus; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 50));
    return apiRequest<FeedbackPage>(`/admin/feedback?${query.toString()}`);
  },

  setStatus: (id: string, status: FeedbackStatus) =>
    apiRequest<{ feedback: { id: string; status: FeedbackStatus } }>(`/admin/feedback/${id}`, {
      method: 'PATCH',
      body: { status },
    }).then((d) => d.feedback),
};

// ------------------------------------------------------------------ staff
/** Admin / Operations / Inventory / Rider sign-ins (backend migration 014). */
export const staff = {
  list: () => apiRequest<{ staff: StaffAccount[] }>('/admin/staff').then((d) => d.staff),

  create: (input: CreateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>('/admin/staff', { method: 'POST', body: { ...input } }).then((d) => d.staff),

  update: (id: string, input: UpdateStaffInput) =>
    apiRequest<{ staff: StaffAccount }>(`/admin/staff/${id}`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.staff
    ),

  /** "Can deliver": gives an Operations/Admin account a rider profile, or switches it off. */
  setRider: (id: string, input: StaffRiderInput) =>
    apiRequest<{ rider: StaffRider | null }>(`/admin/staff/${id}/rider`, { method: 'PUT', body: { ...input } }).then(
      (d) => d.rider
    ),
};

// ---------------------------------------------------------------- coupons
/** Coupon codes (backend migration 018). ADMIN only. */
export const coupons = {
  list: () => apiRequest<{ coupons: Coupon[] }>('/admin/coupons').then((d) => d.coupons),

  create: (input: CouponInput) =>
    apiRequest<{ coupon: Coupon }>('/admin/coupons', { method: 'POST', body: { ...input } }).then((d) => d.coupon),

  update: (id: string, input: Partial<CouponInput>) =>
    apiRequest<{ coupon: Coupon }>(`/admin/coupons/${id}`, { method: 'PATCH', body: { ...input } }).then((d) => d.coupon),

  /** Only a coupon nobody has used (409 COUPON_IN_USE otherwise). */
  remove: (id: string) => apiRequest(`/admin/coupons/${id}`, { method: 'DELETE' }),
};

// ------------------------------------------------------------------ sales
/** Daily sales dashboard; ADMIN only. Days are Asia/Colombo. */
export const reports = {
  sales: (range: SalesRange) => apiRequest<SalesReport>(`/admin/reports/sales?range=${range}`),
};

// -------------------------------------------------------------- customers
/** Customer list and history; ADMIN only (rows carry phone numbers). */
export const customers = {
  list: (params: { search?: string; sort?: CustomerSort; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    query.set('sort', params.sort ?? 'recent');
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 25));
    return apiRequest<{ customers: CustomerRow[]; pagination: Paginated<unknown>['pagination'] }>(`/admin/customers?${query.toString()}`);
  },

  detail: (id: string, page = 1) => apiRequest<CustomerDetail>(`/admin/customers/${id}?page=${page}&limit=20`),

  /** Every customer for the Excel download. */
  exportAll: () => apiRequest<{ customers: CustomerExportRow[] }>('/admin/customers/export'),
};

// ------------------------------------------------------------------- cash
/** Rider cash hand-ins and daily reconciliation (backend migration 019). */
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

// ------------------------------------------------------------- sms offers
/** Offer SMS to registered customers (backend migration 027). ADMIN and OPERATIONS. */
export const smsOffers = {
  /** Who would get it, in which language, and how many SMS parts it costs. */
  estimate: (input: SmsOfferInput) =>
    apiRequest<{ estimate: SmsOfferEstimate }>('/admin/sms-offers/estimate', { method: 'POST', body: { ...input } }).then(
      (d) => d.estimate
    ),

  /** 8 AM - 9 PM only (422 OUTSIDE_SENDING_HOURS). */
  send: (input: SmsOfferInput) =>
    apiRequest<{ offer: SmsOfferSent }>('/admin/sms-offers', { method: 'POST', body: { ...input } }).then((d) => d.offer),

  /**
   * To `phone` when given (Sri Lankan mobile), else the signed-in staff
   * member's own phone; admins have none, so they enter one (400 NO_TEST_PHONE).
   */
  test: (language: SmsLanguage, message: string, phone?: string) =>
    apiRequest<SmsOfferTestResult>('/admin/sms-offers/test', {
      method: 'POST',
      body: phone ? { language, message, phone } : { language, message },
    }),

  /** Newest first. */
  list: () => apiRequest<{ offers: SmsOffer[] }>('/admin/sms-offers').then((d) => d.offers),
};

/** Rider applications from the Rider app, reviewed by Admin or Operations. */
export const riderApplications = {
  list: (status: RiderApprovalStatus, page = 1, limit = 50) =>
    apiRequest<RiderApplicationPage>(`/admin/rider-applications?status=${status}&page=${page}&limit=${limit}`),
  pendingCount: () => apiRequest<{ pending: number }>('/admin/rider-applications/count').then((d) => d.pending),
  approve: (id: string) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/approve`, { method: 'POST' }).then(
      (d) => d.application
    ),
  reject: (id: string, reason: string) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }).then((d) => d.application),
};

// Dental doctors (owner, 2026-10-09): list, add and edit (also the
// activate/deactivate switch). No delete endpoint - deactivate instead.
export const dentalDoctors = {
  list: () => apiRequest<{ doctors: DentalDoctor[] }>('/admin/dental/doctors').then((d) => d.doctors),
  create: (input: DentalDoctorInput) =>
    apiRequest<{ doctor: DentalDoctor }>('/admin/dental/doctors', { method: 'POST', body: { ...input } }).then(
      (d) => d.doctor
    ),
  update: (id: string, input: DentalDoctorInput) =>
    apiRequest<{ doctor: DentalDoctor }>(`/admin/dental/doctors/${id}`, { method: 'PATCH', body: { ...input } }).then(
      (d) => d.doctor
    ),
};
