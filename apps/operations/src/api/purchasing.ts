import { ApiError, apiRequest } from './client';
import { errorMessage } from '../lib/errors';
import type {
  OrderLineBody,
  PoStatus,
  PurchaseOrder,
  PurchaseOrderSummary,
  ReceiveResult,
  ReorderSuggestions,
} from '../lib/purchasing';

/**
 * Staff API for reorder suggestions and supplier purchase orders (migration 058; owner, 2026-10-25).
 * Server: backend/api/src/modules/purchasing (ADMIN and OPERATIONS). Every route answers 503
 * PURCHASING_NOT_READY until the migration has been run in Coolify.
 */
export interface SupplierOption {
  id: string;
  name: string;
  contact_phone: string | null;
  is_active?: boolean;
}

export interface OrderBody {
  supplier_id?: string | null;
  expected_on?: string | null;
  notes?: string | null;
  lines?: OrderLineBody[];
}

export interface OrderListQuery {
  status?: PoStatus | 'ALL' | 'OPEN';
  search?: string;
  supplier_id?: string;
  page?: number;
}

export const purchasing = {
  suggestions: (q: { days: number; cover_days: number; lead_days: number }) =>
    apiRequest<ReorderSuggestions>(`/admin/reorder-suggestions?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}`),

  list: (q: OrderListQuery = {}) => {
    const query = new URLSearchParams({ limit: '50' });
    if (q.status && q.status !== 'ALL') query.set('status', q.status);
    if (q.search) query.set('search', q.search);
    if (q.supplier_id) query.set('supplier_id', q.supplier_id);
    if (q.page) query.set('page', String(q.page));
    return apiRequest<{ purchase_orders: PurchaseOrderSummary[]; page: number; limit: number; total: number }>(`/admin/purchase-orders?${query.toString()}`);
  },

  get: (id: string) => apiRequest<{ purchase_order: PurchaseOrder }>(`/admin/purchase-orders/${id}`).then((d) => d.purchase_order),

  create: (body: OrderBody & { lines: OrderLineBody[] }) =>
    apiRequest<{ purchase_order: PurchaseOrder }>('/admin/purchase-orders', { method: 'POST', body: { ...body } }).then((d) => d.purchase_order),

  update: (id: string, body: OrderBody) =>
    apiRequest<{ purchase_order: PurchaseOrder }>(`/admin/purchase-orders/${id}`, { method: 'PATCH', body: { ...body } }).then((d) => d.purchase_order),

  send: (id: string) =>
    apiRequest<{ purchase_order: PurchaseOrder; message: string; whatsapp_url: string | null }>(`/admin/purchase-orders/${id}/send`, { method: 'POST', body: {} }),

  receive: (id: string, body: { lines: { item_id: string; received_qty: number; unit_cost?: number; update_product_cost?: boolean }[]; close_short?: boolean }) =>
    apiRequest<ReceiveResult>(`/admin/purchase-orders/${id}/receive`, { method: 'POST', body: { ...body } }),

  cancel: (id: string, reason: string) =>
    apiRequest<{ purchase_order: PurchaseOrder }>(`/admin/purchase-orders/${id}/cancel`, { method: 'POST', body: { reason } }).then((d) => d.purchase_order),

  suppliers: () => apiRequest<{ suppliers: SupplierOption[] }>('/admin/suppliers').then((d) => d.suppliers),
};

/** "Not switched on yet: run database migration 058" for a 503 PURCHASING_NOT_READY; else the usual words. */
export function purchasingError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'PURCHASING_NOT_READY') {
    return 'Not switched on yet: run database migration 058 in Coolify first.';
  }
  return errorMessage(err, fallback);
}
