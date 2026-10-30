import { apiRequest } from './client';
import type {
  AdminSeller,
  AdminSubmission,
  CommissionSettings,
  CreateSellerBody,
  PayoutRequest,
  PayoutRequestStatus,
  SellerPayout,
  SellerStatement,
  SellerStatus,
  SubmissionStatus,
} from '../lib/sellers';
import type { NewShopProductBody, SellerShopProduct } from '../lib/sellerShop';

/**
 * Seller admin for Blynk Ops (owner, 2026-10-25: "an Add seller, and the rest of the seller admin,
 * inside Ops"). The same staff endpoints Admin uses (ADMIN and OPERATIONS may call them); this is Ops'
 * own copy of apps/admin's seller clients, kept out of resources.ts on purpose.
 *
 * Migration 053 (shop location) and 057 (payout requests, category commission) are run
 * by hand: before them these answer 503 `*_NOT_READY` and the screens say so (lib/sellers.ts notReady).
 */

const query = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const qs = q.toString();
  return qs ? `?${qs}` : '';
};

export const sellers = {
  list: (params: { status?: SellerStatus; search?: string } = {}) =>
    apiRequest<{ sellers: AdminSeller[] }>(`/admin/sellers${query(params)}`).then((d) => d.sellers ?? []),
  get: (id: string) => apiRequest<{ seller: AdminSeller; statement: SellerStatement }>(`/admin/sellers/${id}`),
  /** Sellers are invite-only: staff add each shop with the phone it signs in with. 409 PHONE_IN_USE when the number has an account. */
  create: (body: CreateSellerBody) =>
    apiRequest<{ seller: AdminSeller }>('/admin/sellers', { method: 'POST', body: { ...body } }).then((d) => d.seller),
  /** Approve / reject (reason needed) / suspend, the commission percent (null = category rates), the sign-in phone and contact details. */
  update: (
    id: string,
    body: {
      status?: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
      rejection_reason?: string;
      commission_percent?: number | null;
      phone?: string;
      shop_name?: string;
      contact_name?: string | null;
      address?: string | null;
      note?: string | null;
      /** Migration 065: end of the commission-free period (ISO instant); null = none. */
      commission_free_until?: string | null;
    }
  ) => apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}`, { method: 'PATCH', body: { ...body } }).then((d) => d.seller),
  recordPayout: (id: string, body: { amount: number; note?: string; paid_on?: string }) =>
    apiRequest<{ payout: SellerPayout; statement: SellerStatement }>(`/admin/sellers/${id}/payouts`, { method: 'POST', body: { ...body } }),
  deletePayout: (id: string, payoutId: string) =>
    apiRequest<{ statement: SellerStatement }>(`/admin/sellers/${id}/payouts/${payoutId}`, { method: 'DELETE' }).then((d) => d.statement),
  /** The seller's waiting shop pin becomes the one in use (migration 053). */
  approveLocation: (id: string) =>
    apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}/location/approve`, { method: 'POST', body: {} }).then((d) => d.seller),
  rejectLocation: (id: string, reason: string) =>
    apiRequest<{ seller: AdminSeller }>(`/admin/sellers/${id}/location/reject`, { method: 'POST', body: { reason } }).then((d) => d.seller),
  /** Staff set the shop pin directly: it becomes the approved location (2026-10-30). The seller row comes back when the API sends it. */
  setLocation: (id: string, body: { latitude: number; longitude: number; how_to_find?: string }) =>
    apiRequest<{ seller?: AdminSeller }>(`/admin/sellers/${id}/location`, { method: 'PUT', body: { ...body } }).then((d) => d?.seller ?? null),
  /** The seller's products with their status (LIVE / PAUSED / OFF) and stock. */
  products: (id: string) =>
    apiRequest<{ products: SellerShopProduct[] }>(`/admin/sellers/${id}/products`).then((d) => d.products ?? []),
  /** Staff add a live product for an APPROVED seller; the photo is required (400 IMAGE_REQUIRED). */
  addProduct: (id: string, body: NewShopProductBody) =>
    apiRequest<{ product: SellerShopProduct }>(`/admin/sellers/${id}/products`, { method: 'POST', body: { ...body } }).then((d) => d.product),
};

export const sellerSubmissions = {
  /** Oldest first. The API defaults to PENDING. */
  list: (params: { status?: SubmissionStatus; seller_id?: string } = {}) =>
    apiRequest<{ submissions: AdminSubmission[] }>(`/admin/seller-submissions${query(params)}`).then((d) => d.submissions ?? []),
  pendingCount: () => sellerSubmissions.list({ status: 'PENDING' }).then((rows) => rows.length),
  approve: (id: string, body: { selling_price?: number; category_id?: string }) =>
    apiRequest<{ submission: AdminSubmission }>(`/admin/seller-submissions/${id}/approve`, { method: 'POST', body: { ...body } }),
  reject: (id: string, reason: string) =>
    apiRequest<{ submission: AdminSubmission }>(`/admin/seller-submissions/${id}/reject`, { method: 'POST', body: { reason } }).then((d) => d.submission),
};

/** Sellers asking to be paid (migration 057). Paying records the payout (the same ledger as "Record payment"). */
export const sellerPayoutRequests = {
  /** REQUESTED (waiting, oldest first) unless asked; ALL = every status. */
  list: (params: { status?: PayoutRequestStatus | 'ALL'; seller_id?: string } = {}) =>
    apiRequest<{ payout_requests: PayoutRequest[] }>(`/admin/seller-payout-requests${query(params)}`).then((d) => d.payout_requests ?? []),
  pay: (id: string, body: { paid_on?: string; note?: string } = {}) =>
    apiRequest<{ payout_request: PayoutRequest; payout: SellerPayout; statement: SellerStatement }>(`/admin/seller-payout-requests/${id}/pay`, {
      method: 'POST',
      body: { ...body },
    }),
  decline: (id: string, reason: string) =>
    apiRequest<{ payout_request: PayoutRequest }>(`/admin/seller-payout-requests/${id}/decline`, { method: 'POST', body: { reason } }).then(
      (d) => d.payout_request
    ),
};

/** What Blynk keeps from seller sales: a default %, optional per-category rates (a sub-category falls back to its main one); a seller's own rate beats both. */
export const sellerCommission = {
  get: () => apiRequest<CommissionSettings>('/admin/settings/seller-commission'),
  save: (body: { default_percent: number; categories: { category_id: string; percent: number | null }[]; free_days?: number }) =>
    apiRequest<CommissionSettings>('/admin/settings/seller-commission', { method: 'PUT', body: { ...body } }),
};
