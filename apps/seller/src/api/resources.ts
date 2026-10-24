import { apiRequest, tokenStore } from './client';
import type {
  AuthUser,
  Category,
  ProductInput,
  ProfileInput,
  Seller,
  SellerMe,
  SellerProduct,
  Statement,
  Submission,
} from './types';

// ---------------------------------------------------------------- auth
export const auth = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string; expires_in_minutes?: number }>('/auth/otp/request', {
      method: 'POST',
      body: { phone },
      auth: false,
    }),

  /** `shop_name` is only used the first time a number signs in (it creates the shop). */
  verifyOtp: (phone: string, otp: string, shopName?: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp, app: 'seller', ...(shopName ? { shop_name: shopName } : {}) },
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
};
