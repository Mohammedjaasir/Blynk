import { apiRequest } from './client';

/**
 * Blynk Wallet (owner, 2026-10-15; docs/api/wallet.md). Every approved refund
 * goes to the customer's wallet; the balance pays for later orders and is
 * never cash. Kept in its own file like Blynk Points. ADMIN and OPERATIONS
 * may read and refund; only ADMIN may adjust a balance. The server audits
 * every change.
 */

/** `GET|PATCH /admin/settings/wallet`. */
export interface WalletSetting {
  /** false hides "Use wallet balance" at checkout; refunds are still credited. */
  enabled: boolean;
  /** 0 = never; otherwise credits added expire this many months later. */
  expiry_months: number;
  /** Most of what is due after points (delivery fee included) the wallet may pay, 1-100. */
  max_use_percent: number;
  updated_at: string | null;
}

export type WalletSettingInput = Partial<Omit<WalletSetting, 'updated_at'>>;

export type WalletKind =
  | 'ORDER_PAYMENT'
  | 'ORDER_PAYMENT_RETURNED'
  | 'REFUND_ORDER_CANCELLED'
  | 'REFUND_ITEM'
  | 'REFUND_DELIVERY_FEE'
  | 'ADJUSTMENT'
  | 'EXPIRED';

/** One ledger row (staff shape: who made it is included). */
export interface WalletEntry {
  id: string;
  kind: WalletKind;
  /** Signed LKR: + credit, - debit. */
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

/** `GET /admin/customers/:id/wallet` (and what an adjustment returns). */
export interface CustomerWallet {
  customer_id: string;
  enabled: boolean;
  balance: number;
  entries: WalletEntry[];
  pagination: WalletPagination;
}

/** `GET /admin/orders/:id/wallet`: what was paid, what is still refundable. */
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
  refundable: number;
  delivery_fee_refundable: number;
  points: { redeemed: number; returnable: number; earned: number };
  /** Credits back to the wallet for this order, newest first. */
  entries: WalletEntry[];
}

/** The two refunds staff may make by hand. */
export type WalletRefundKind = 'REFUND_ITEM' | 'REFUND_DELIVERY_FEE';

export interface WalletRefundBody {
  amount: number;
  kind: WalletRefundKind;
  /** 3-200 characters - the customer sees it in their wallet history. */
  reason: string;
  /** Blynk Points used on the refunded item to give back (whole, <= points.returnable). */
  return_points?: number;
}

/** `POST /admin/orders/:id/wallet-refund` (201). */
export interface WalletRefundResult {
  refund: WalletEntry;
  points_returned: number;
  points_removed: number;
  wallet: OrderWallet;
}

const PATH_SETTINGS = '/admin/settings/wallet';
const customerPath = (id: string) => `/admin/customers/${encodeURIComponent(id)}/wallet`;
const orderPath = (id: string) => `/admin/orders/${encodeURIComponent(id)}`;

export const wallet = {
  getSetting: () => apiRequest<WalletSetting>(PATH_SETTINGS),
  /** Send only what changed - the server refuses an empty body. */
  setSetting: (body: WalletSettingInput) => apiRequest<WalletSetting>(PATH_SETTINGS, { method: 'PATCH', body: { ...body } }),
  customerWallet: (customerId: string, params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 50));
    return apiRequest<CustomerWallet>(`${customerPath(customerId)}?${q.toString()}`);
  },
  /** ADMIN only. Returns the customer wallet shape (first page). */
  adjust: (customerId: string, body: { amount: number; reason: string }) =>
    apiRequest<CustomerWallet>(`${customerPath(customerId)}/adjust`, { method: 'POST', body: { ...body } }),
  orderWallet: (orderId: string) => apiRequest<OrderWallet>(`${orderPath(orderId)}/wallet`),
  refund: (orderId: string, body: WalletRefundBody) =>
    apiRequest<WalletRefundResult>(`${orderPath(orderId)}/wallet-refund`, { method: 'POST', body: { ...body } }),
};
