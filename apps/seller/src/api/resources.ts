import { apiRequest, tokenStore } from './client';
import type {
  AuthUser,
  Category,
  InsightDays,
  Insights,
  LocationInput,
  PayoutRequest,
  PayoutRequestInput,
  ProductInput,
  ProfileInput,
  Seller,
  SellerMe,
  SellerProduct,
  Statement,
  StockNote,
  StockNoteInput,
  StoreInfo,
  Submission,
} from './types';

// ---------------------------------------------------------------- auth
/** What the sign-in route returns. */
export interface SessionPayload {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

export const auth = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string; expires_in_minutes?: number }>('/auth/otp/request', {
      method: 'POST',
      body: { phone },
      auth: false,
    }),

  /**
   * Sellers are invite-only: only a number Blynk registered for a shop signs in
   * (403 SELLER_NOT_REGISTERED otherwise). Nothing is created here.
   */
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<SessionPayload>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp, app: 'seller' },
      auth: false,
    }),

  me: () => apiRequest<AuthUser>('/auth/me'),

  // Send the refresh token so the server revokes it: without it the session
  // outlives sign-out.
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', body: tokenStore.refresh ? { refresh_token: tokenStore.refresh } : {} }),
};

// ---------------------------------------------------------------- seller
export const sellerApi = {
  me: () => apiRequest<SellerMe>('/seller/me'),

  updateProfile: (input: ProfileInput) =>
    apiRequest<{ seller: Seller }>('/seller/profile', { method: 'PUT', body: { ...input } }),

  /** Send the shop pin; it waits for Admin (the approved point stays in use until then). */
  sendLocation: (input: LocationInput) =>
    apiRequest<{ seller: Seller }>('/seller/profile', { method: 'PUT', body: { ...input } }),

  /** Public store info: where the Blynk store is (to start the map and measure distance). */
  store: () => apiRequest<StoreInfo>('/store', { auth: false }),

  categories: () => apiRequest<{ categories: Category[] }>('/seller/categories').then((r) => r.categories),

  products: () => apiRequest<{ products: SellerProduct[] }>('/seller/products').then((r) => r.products),

  addProduct: (input: ProductInput) =>
    apiRequest<{ submission: Submission }>('/seller/products', { method: 'POST', body: { ...input } }).then(
      (r) => r.submission
    ),

  editProduct: (productId: string, input: Partial<ProductInput>) =>
    apiRequest<{ submission: Submission }>(`/seller/products/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: { ...input },
    }).then((r) => r.submission),

  withdraw: (submissionId: string) =>
    apiRequest<{ submission: Submission }>(`/seller/submissions/${encodeURIComponent(submissionId)}`, {
      method: 'DELETE',
    }).then((r) => r.submission),

  /** Multipart upload; the browser sets the boundary, so no Content-Type here. */
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiRequest<{ url: string }>('/seller/uploads/image', { method: 'POST', body: form }).then((r) => r.url);
  },

  statement: (range: { from?: string; to?: string } = {}) => {
    const query = new URLSearchParams();
    if (range.from) query.set('from', range.from);
    if (range.to) query.set('to', range.to);
    const qs = query.toString();
    return apiRequest<Statement>(`/seller/statement${qs ? `?${qs}` : ''}`);
  },

  // ------------------------------------------------- stock notes (SENT -> RECEIVED / CANCELLED)
  stockNotes: () => apiRequest<{ notes: StockNote[] }>('/seller/stock-notes').then((r) => r.notes ?? []),

  sendStockNote: (input: StockNoteInput) =>
    apiRequest<{ note: StockNote }>('/seller/stock-notes', { method: 'POST', body: { ...input } }),

  /** Cancel a note Blynk has not received yet. */
  cancelStockNote: (id: string) =>
    apiRequest<unknown>(`/seller/stock-notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ------------------------------------------------- payout requests (one open at a time)
  payoutRequests: () =>
    apiRequest<{ requests: PayoutRequest[] }>('/seller/payout-requests').then((r) => r.requests ?? []),

  askForPayment: (input: PayoutRequestInput) =>
    apiRequest<unknown>('/seller/payout-requests', { method: 'POST', body: { ...input } }),

  /** Withdraw a request Blynk has not handled yet. */
  withdrawPayoutRequest: (id: string) =>
    apiRequest<unknown>(`/seller/payout-requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ------------------------------------------------- insights
  insights: (days: InsightDays) => apiRequest<Insights>(`/seller/insights?days=${days}`),
};
