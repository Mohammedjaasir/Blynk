import { apiRequest } from './client';

/**
 * Blynk Wallet (owner, 2026-10-15; contract docs/api/wallet.md). Every
 * approved refund goes to the customer's wallet; the balance pays for future
 * orders and is never paid out as cash. Operations may read the settings and
 * a customer's or an order's wallet, change the settings and refund an order
 * to the wallet. Manual adjustments (`/wallet/adjust`) are ADMIN only and
 * deliberately not here.
 */

export type WalletKind =
  | 'ORDER_PAYMENT'
  | 'ORDER_PAYMENT_RETURNED'
  | 'REFUND_ORDER_CANCELLED'
  | 'REFUND_ITEM'
  | 'REFUND_DELIVERY_FEE'
  | 'ADJUSTMENT'
  | 'EXPIRED';

/** The two refunds staff can give from an order. */
export type WalletRefundKind = 'REFUND_ITEM' | 'REFUND_DELIVERY_FEE';

/** `GET|PATCH /admin/settings/wallet`. */
export interface WalletSetting {
  enabled: boolean;
  /** Whole months, 0-120; 0 = credits never expire. */
  expiry_months: number;
  /** Whole %, 1-100: the most of what is due after points the wallet may pay. */
  max_use_percent: number;
  updated_at: string | null;
}

export type WalletSettingInput = Partial<Omit<WalletSetting, 'updated_at'>>;

/** One ledger row (staff view: who added it is included). */
export interface WalletEntry {
  id: string;
  kind: WalletKind;
  /** Signed: + credited, - spent / expired. */
  amount: number;
  order_id: string | null;
  order_number: string | null;
  reason: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface WalletPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** `GET /admin/customers/:id/wallet`. */
export interface CustomerWallet {
  customer_id: string;
  enabled: boolean;
  balance: number;
  entries: WalletEntry[];
  pagination: WalletPagination;
}

/** `GET /admin/orders/:id/wallet`. */
export interface OrderWallet {
  order_id: string;
  order_number: string;
  customer_id: string;
  order_status: string;
  payment_method: string;
  wallet_amount_used: number;
  delivery_fee: number;
  paid: { wallet: number; online: number; cash: number; total: number };
  refunded_total: number;
  /** What can still go back to the wallet for this order. */
  refundable: number;
  /** The delivery fee minus fee refunds so far. */
  delivery_fee_refundable: number;
  points: { redeemed: number; returnable: number; earned: number };
  /** Credits back to the wallet for this order, newest first. */
  entries: WalletEntry[];
}

export interface WalletRefundInput {
  amount: number;
  kind: WalletRefundKind;
  reason: string;
  return_points?: number;
}

/** `POST /admin/orders/:id/wallet-refund` (201). */
export interface WalletRefundResult {
  refund: WalletEntry;
  points_returned: number;
  points_removed: number;
  wallet: OrderWallet;
}

const SETTINGS = '/admin/settings/wallet';

export const wallet = {
  getSetting: () => apiRequest<WalletSetting>(SETTINGS),
  /** Send only what changed - the server refuses an empty body. */
  setSetting: (body: WalletSettingInput) => apiRequest<WalletSetting>(SETTINGS, { method: 'PATCH', body: { ...body } }),
  customer: (customerId: string, params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 50));
    return apiRequest<CustomerWallet>(`/admin/customers/${encodeURIComponent(customerId)}/wallet?${q.toString()}`);
  },
  order: (orderId: string) => apiRequest<OrderWallet>(`/admin/orders/${encodeURIComponent(orderId)}/wallet`),
  refund: (orderId: string, body: WalletRefundInput) =>
    apiRequest<WalletRefundResult>(`/admin/orders/${encodeURIComponent(orderId)}/wallet-refund`, {
      method: 'POST',
      body: { ...body },
    }),
};
