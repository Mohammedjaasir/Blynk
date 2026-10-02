import { apiRequest } from './client';
import type {
  BoardOrder,
  OrderDetail,
  RiderOption,
  RiderSuggestions,
  AdminProduct,
  AuthUser,
  Category,
  CategoryDeleteResult,
  CustomerProduct,
  DeliveryFeeSetting,
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
  CustomerRow,
  CustomerSort,
  SalesRange,
  SalesReport,
} from './types';

/**
 * Typed wrappers over the existing Blynk endpoints. No endpoint is invented
 * here: admin catalog routes already existed, promotions and media were
 * added in this phase.
 */

// ---------------------------------------------------------------- auth
export const auth = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string; expires_in_minutes?: number }>(
      '/auth/otp/request',
      { method: 'POST', body: { phone }, auth: false }
    ),

  /** Staff email + password sign-in (backend migration 012). */
  staffLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{
      access_token: string;
      refresh_token: string;
      user: AuthUser;
    }>('/auth/otp/verify', { method: 'POST', body: { phone, otp }, auth: false }),

  me: () => apiRequest<AuthUser>('/auth/me'),

  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
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

// -------------------------------------------------------------- products
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
export const orders = {
  live: () =>
    apiRequest<{ orders: BoardOrder[] }>(`/admin/orders?status=${LIVE_STATUSES}&limit=100`).then((d) => d.orders),

  closedSince: (since: Date) =>
    apiRequest<{ orders: BoardOrder[] }>(
      `/admin/orders?status=DELIVERED,CANCELLED&since=${encodeURIComponent(since.toISOString())}&limit=100`
    ).then((d) => d.orders),

  detail: (id: string) => apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}`).then((d) => d.order),

  setStatus: (id: string, status: string, notes?: string) =>
    apiRequest<{ order: unknown }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: notes === undefined ? { status } : { status, notes },
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
