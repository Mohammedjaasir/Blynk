import { apiRequest } from './client';
import type {
  AuthUser,
  LedgerEntry,
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
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp },
      auth: false,
    }),
  me: () => apiRequest<AuthUser>('/auth/me'),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
};

export interface StockQuery {
  search?: string;
  tracking_mode?: TrackingMode;
  low_stock_only?: boolean;
  include_inactive?: boolean;
  page?: number;
  limit?: number;
}

export const stockApi = {
  list: (query: StockQuery = {}) =>
    apiRequest<{ inventory: StockRow[]; pagination: Pagination }>('/admin/inventory', { query: { ...query } }),
  detail: (productId: string) => apiRequest<StockDetail>(`/admin/inventory/${productId}`),
  setMode: (productId: string, tracking_mode: TrackingMode) =>
    apiRequest(`/admin/inventory/${productId}/mode`, { method: 'PATCH', body: { tracking_mode } }),
  adjust: (productId: string, body: { adjustment_type: ManualAdjustmentType; quantity_delta: number; notes: string }) =>
    apiRequest<{ inventory: { quantity_on_hand: number; quantity_available: number } }>(
      `/admin/inventory/${productId}/adjust`,
      { method: 'POST', body }
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

export const sourcingApi = {
  /** Open orders, reduced to the fields sourcing needs (no customer PII). */
  async openOrders(): Promise<QueueOrder[]> {
    const pages = await Promise.all(
      SOURCEABLE_STATUSES.map((status) =>
        apiRequest<{ orders: Array<QueueOrder & { created_at: string; placed_at: string | null }> }>(
          '/admin/orders',
          { query: { status, limit: 100 } }
        )
      )
    );
    return pages
      .flatMap((page) => page.orders)
      .map((o) => ({
        id: o.id,
        order_number: o.order_number,
        order_status: o.order_status,
        placed_at: o.placed_at ?? o.created_at,
      }));
  },
  detail: (orderId: string) => apiRequest<OrderSourcing>(`/admin/orders/${orderId}/sourcing`),
  source: (
    orderId: string,
    itemId: string,
    body: { actual_unit_cost: number; quantity: number; supplier_id?: string; notes?: string }
  ) => apiRequest(`/admin/orders/${orderId}/items/${itemId}/source`, { method: 'POST', body }),
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
