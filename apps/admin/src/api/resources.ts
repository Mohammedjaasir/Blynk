import { apiRequest } from './client';
import type {
  BoardOrder,
  OrderDetail,
  RiderOption,
  AdminProduct,
  AuthUser,
  Category,
  CustomerProduct,
  Paginated,
  Promotion,
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

  assignRider: (id: string, riderId: string) =>
    apiRequest<{ delivery: unknown }>(`/admin/orders/${id}/assign-rider`, {
      method: 'POST',
      body: { rider_id: riderId },
    }),
};

export const riders = {
  /** Active riders only (the API filters); no availability flag exists. */
  listActive: () => apiRequest<{ riders: RiderOption[] }>('/admin/riders').then((d) => d.riders),
};
