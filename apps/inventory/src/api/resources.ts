import { apiRequest, tokenStore } from './client';
import type {
  AuthUser,
  LedgerEntry,
  LowStockReport,
  ManualAdjustmentType,
  OrderSourcing,
  OrderStatus,
  Pagination,
  QueueOrder,
  StockDetail,
  StockRow,
  Supplier,
  SupplierInput,
  TrackingMode,
  AdjustmentType,
} from './types';

/** Existing Blynk OTP auth - the same endpoints every Blynk app uses. */
export const authApi = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string }>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),
  /** Staff email + password sign-in (backend migration 012). */
  staffLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  /**
   * create_account: false - Inventory is staff-only, so an unknown number must
   * never become a new customer account (404 ACCOUNT_NOT_FOUND instead).
   */
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp, create_account: false },
      auth: false,
    }),
  me: () => apiRequest<AuthUser>('/auth/me'),
  // Send the refresh token so the server revokes it: without it the route
  // knows neither the session nor the user, and the session outlives sign-out.
  // POST /auth/logout needs no access token: the refresh token alone names the
  // session. Pass one explicitly to revoke tokens that were never stored (a
  // sign-in refused for its role).
  logout: (refreshToken: string | null = tokenStore.refresh) =>
    apiRequest('/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refresh_token: refreshToken } : {},
      auth: false,
    }),
};

export interface StockQuery {
  search?: string;
  tracking_mode?: TrackingMode;
  low_stock_only?: boolean;
  include_inactive?: boolean;
  page?: number;
  limit?: number;
}

/** The backend's largest page (inventoryQuerySchema: limit max 100). */
export const MAX_PAGE_SIZE = 100;

export const stockApi = {
  list: (query: StockQuery = {}) =>
    apiRequest<{ inventory: StockRow[]; pagination: Pagination }>('/admin/inventory', { query: { ...query } }),
  /**
   * Every matching row, page by page. For lookups and filters (product
   * pickers, the sourcing queue's stock column, "Needs stock") that must not
   * silently stop at the first 100 products.
   */
  async listAll(query: Omit<StockQuery, 'page' | 'limit'> = {}): Promise<{ inventory: StockRow[] }> {
    const first = await stockApi.list({ ...query, page: 1, limit: MAX_PAGE_SIZE });
    const rows = [...first.inventory];
    const totalPages = first.pagination?.total_pages ?? 1;
    for (let page = 2; page <= totalPages; page++) {
      const next = await stockApi.list({ ...query, page, limit: MAX_PAGE_SIZE });
      rows.push(...next.inventory);
    }
    return { inventory: rows };
  },
  detail: (productId: string) => apiRequest<StockDetail>(`/admin/inventory/${productId}`),
  setMode: (productId: string, tracking_mode: TrackingMode) =>
    apiRequest(`/admin/inventory/${productId}/mode`, { method: 'PATCH', body: { tracking_mode } }),
  adjust: (productId: string, body: { adjustment_type: ManualAdjustmentType; quantity_delta: number; notes: string }) =>
    apiRequest<{ inventory: { quantity_on_hand: number; quantity_available: number } }>(
      `/admin/inventory/${productId}/adjust`,
      { method: 'POST', body }
    ),
  /** Tracked products at or below their threshold, OUT first (all roles here). */
  lowStock: () => apiRequest<LowStockReport>('/admin/inventory/low-stock'),
  /** ADMIN only in this app; 409 PRODUCT_NOT_TRACKED for an untracked product. */
  setThreshold: (productId: string, low_stock_threshold: number) =>
    apiRequest<{ low_stock_threshold: number; is_low_stock: boolean }>(
      `/admin/inventory/${productId}/threshold`,
      { method: 'PATCH', body: { low_stock_threshold } }
    ),
};

export interface LedgerQuery {
  product_id?: string;
  type?: AdjustmentType;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const ledgerApi = {
  list: (query: LedgerQuery = {}) =>
    apiRequest<{ adjustments: LedgerEntry[]; pagination: Pagination }>('/admin/inventory/adjustments', {
      query: { ...query },
    }),
};

/**
 * Order statuses that can still have items waiting to be sourced. Resolving
 * an item as unavailable moves the whole order to ITEM_UNAVAILABLE, and its
 * other items may still need sourcing, so both statuses feed the queue.
 */
const SOURCEABLE_STATUSES: OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE'];

/** The most pages of open orders read per status in one load (2,000 orders). */
export const MAX_ORDER_PAGES = 20;

export interface OpenOrders {
  orders: QueueOrder[];
  /** Open orders the backend has in total (pagination.total, per status, summed). */
  total: number;
  /** True only when MAX_ORDER_PAGES stopped the read with orders left unread. */
  truncated: boolean;
}

type OrdersPage = {
  orders: Array<QueueOrder & { created_at: string; placed_at: string | null }>;
  pagination?: Pagination;
};

export const sourcingApi = {
  /**
   * Every open order, reduced to the fields sourcing needs (no customer PII).
   * Each status is read page by page, in sequence, up to
   * pagination.total_pages (at most MAX_ORDER_PAGES); `total` is the API's
   * count. An order that moved between reads is kept once.
   */
  async openOrders(): Promise<OpenOrders> {
    const raw: OrdersPage['orders'] = [];
    let total = 0;
    let truncated = false;
    for (const status of SOURCEABLE_STATUSES) {
      const read = (page: number) =>
        apiRequest<OrdersPage>('/admin/orders', { query: { status, page, limit: MAX_PAGE_SIZE } });
      const first = await read(1);
      raw.push(...first.orders);
      total += Math.max(first.pagination?.total ?? 0, first.orders.length);
      const totalPages = first.pagination?.total_pages ?? 1;
      if (totalPages > MAX_ORDER_PAGES) truncated = true;
      for (let page = 2; page <= Math.min(totalPages, MAX_ORDER_PAGES); page += 1) {
        const next = await read(page);
        raw.push(...next.orders);
        if (next.orders.length < MAX_PAGE_SIZE) break;
      }
    }
    const seen = new Set<string>();
    const orders = raw
      .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
      .map((o) => ({
        id: o.id,
        order_number: o.order_number,
        order_status: o.order_status,
        placed_at: o.placed_at ?? o.created_at,
      }));
    return { orders, total, truncated };
  },
  detail: (orderId: string) => apiRequest<OrderSourcing>(`/admin/orders/${orderId}/sourcing`),
  source: (
    orderId: string,
    itemId: string,
    // Always the full ordered quantity: the backend refuses partial sourcing
    // (400 PARTIAL_SOURCING_NOT_SUPPORTED); short stock means "mark unavailable".
    body: { actual_unit_cost: number; quantity?: number; supplier_id?: string; notes?: string }
  ) => apiRequest(`/admin/orders/${orderId}/items/${itemId}/source`, { method: 'POST', body }),
  /**
   * Pack an order whose items are all sourced or unavailable. PATCH status
   * PACKED is the only status change this app makes (ADMIN and PACKING_STAFF);
   * the backend refuses anything else, and a stale order with 422/409.
   */
  markPacked: (orderId: string) =>
    apiRequest(`/admin/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'PACKED' } }),
  /** Existing order-resolution flow (D4): removes the item, recalculates, notifies. */
  markUnavailable: (orderId: string, itemId: string) =>
    apiRequest(`/admin/orders/${orderId}/resolve-item`, {
      method: 'POST',
      body: { item_id: itemId, item_status: 'UNAVAILABLE' },
    }),
};

export const suppliersApi = {
  list: (activeOnly: boolean) =>
    apiRequest<{ suppliers: Supplier[] }>('/admin/suppliers', { query: { active_only: String(activeOnly) } }).then(
      (d) => d.suppliers
    ),
  create: (body: SupplierInput) =>
    apiRequest<{ supplier: Supplier }>('/admin/suppliers', { method: 'POST', body: { ...body } }).then(
      (d) => d.supplier
    ),
  update: (id: string, body: SupplierInput) =>
    apiRequest<{ supplier: Supplier }>(`/admin/suppliers/${id}`, { method: 'PATCH', body: { ...body } }).then(
      (d) => d.supplier
    ),
};
