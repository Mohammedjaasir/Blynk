import { ApiError, apiRequest } from './client';
import { errorMessage } from '../lib/errors';

/**
 * Expiry dates (wave 2, 2026-10-25; migration 059): the batch register. Every endpoint answers
 * 503 EXPIRY_NOT_READY until the migration has been run in Coolify.
 *
 *   GET  /admin/stock-batches?bucket=expired|week|month|all&product_id=&status=
 *   GET  /admin/stock-batches/summary
 *   POST /admin/stock-batches                    { product_id, variant_id?, batch_code?, quantity, expires_on, note? }
 *   PATCH /admin/stock-batches/:id
 *   POST /admin/stock-batches/:id/sold-out
 *   POST /admin/stock-batches/:id/discard        { reason?: EXPIRED | WASTE, reduce_stock?, note? }
 *   GET  /admin/stock-batches/product/:id        the product's switch + its open batches
 *   PUT  /admin/stock-batches/product/:id/tracking   { enabled }
 */
export type BatchBucket = 'expired' | 'week' | 'month' | 'all';
export type BatchStatus = 'ACTIVE' | 'SOLD_OUT' | 'DISCARDED';
export type BatchSeverity = 'expired' | 'red' | 'amber' | 'ok';

export interface StockBatch {
  id: string;
  product_id: string;
  product_name: string;
  product_sku?: string;
  product_unit?: string;
  image_url?: string | null;
  variant_id: string | null;
  variant_label: string | null;
  batch_code: string | null;
  quantity: number;
  /** 'YYYY-MM-DD' (Colombo calendar day). */
  expires_on: string;
  days_left: number;
  severity: BatchSeverity;
  label: string;
  status: BatchStatus;
  note: string | null;
  received_at: string;
  created_by_name?: string | null;
  discarded_at?: string | null;
  discard_reason?: 'EXPIRED' | 'WASTE' | null;
  discard_stock_removed?: number | null;
}

export interface BatchList {
  today: string;
  batches: StockBatch[];
  total: number;
  page: number;
  limit: number;
}

export interface BucketCount {
  batches: number;
  units: number;
}
export interface ExpirySummary {
  today: string;
  expired: BucketCount;
  week: BucketCount;
  month: BucketCount;
  within_3_days: number;
  total_active: number;
}

export interface NewBatch {
  product_id: string;
  variant_id?: string | null;
  batch_code?: string | null;
  quantity: number;
  expires_on: string;
  note?: string | null;
}

export interface DiscardResult {
  batch: StockBatch;
  /** How many units came off the product's stock count (0 when not tracked or already empty). */
  stock_removed: number;
  stock: { on_hand: number; reserved: number } | null;
}

export interface ProductExpiry {
  product_id: string;
  product_name: string;
  expiry_tracking: boolean;
  batches: StockBatch[];
}

export const expiryApi = {
  summary: () => apiRequest<ExpirySummary>('/admin/stock-batches/summary'),
  list: (params: { bucket?: BatchBucket; product_id?: string; status?: BatchStatus; limit?: number } = {}) => {
    const query: Record<string, string> = { limit: String(params.limit ?? 200) };
    if (params.bucket) query.bucket = params.bucket;
    if (params.product_id) query.product_id = params.product_id;
    if (params.status) query.status = params.status;
    return apiRequest<BatchList>('/admin/stock-batches', { query });
  },
  add: (body: NewBatch) =>
    apiRequest<{ batch: StockBatch }>('/admin/stock-batches', { method: 'POST', body: { ...body } }).then((d) => d.batch),
  update: (id: string, body: Partial<Pick<NewBatch, 'batch_code' | 'quantity' | 'expires_on' | 'note'>>) =>
    apiRequest<{ batch: StockBatch }>(`/admin/stock-batches/${id}`, { method: 'PATCH', body: { ...body } }).then((d) => d.batch),
  soldOut: (id: string) =>
    apiRequest<{ batch: StockBatch }>(`/admin/stock-batches/${id}/sold-out`, { method: 'POST', body: {} }).then((d) => d.batch),
  discard: (id: string, body: { reason?: 'EXPIRED' | 'WASTE'; reduce_stock?: boolean; note?: string } = {}) =>
    apiRequest<DiscardResult>(`/admin/stock-batches/${id}/discard`, { method: 'POST', body: { ...body } }),
  product: (productId: string) => apiRequest<ProductExpiry>(`/admin/stock-batches/product/${productId}`),
  setTracking: (productId: string, enabled: boolean) =>
    apiRequest<ProductExpiry>(`/admin/stock-batches/product/${productId}/tracking`, { method: 'PUT', body: { enabled } }),
};

/** True for the 503 an API answers before migration 059 has been run. */
export const isExpiryNotReady = (err: unknown) => err instanceof ApiError && err.code === 'EXPIRY_NOT_READY';

/** Words for an error; the 503 says which migration to run. */
export function expiryErrorMessage(err: unknown, fallback: string): string {
  if (isExpiryNotReady(err)) return 'Not switched on yet: run database migration 059 in Coolify first.';
  return errorMessage(err, fallback);
}
