import { API_BASE_URL, ApiError, apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import { parseCheckout, type CheckoutForm } from './form';

/*
 * POST /payments/payhere/checkout { order_id } (only the order's owner): the form to post to
 * PayHere. Calling it again for the same order is allowed (a retry after a failed card).
 */
export async function startPayHereCheckout(orderId: string): Promise<CheckoutForm> {
  const data = await authed((t) => apiPost<unknown>('/payments/payhere/checkout', { order_id: orderId }, t));
  return parseCheckout(data, API_BASE_URL);
}

export type CheckoutRefusal = 'paid' | 'expired' | 'notAwaiting' | 'unavailable' | 'notFound' | 'notOnline' | 'bad' | 'other';

/** The checkout call's refusals (docs/api/payhere.md §3). */
export function checkoutRefusal(e: unknown): CheckoutRefusal {
  if (!(e instanceof ApiError)) return 'other';
  switch (e.code) {
    case 'ORDER_ALREADY_PAID': return 'paid';
    case 'PAYMENT_EXPIRED': return 'expired';
    case 'ORDER_NOT_AWAITING_PAYMENT': return 'notAwaiting';
    case 'ONLINE_PAYMENT_UNAVAILABLE': return 'unavailable';
    case 'ORDER_NOT_FOUND': return 'notFound';
    case 'NOT_ONLINE_ORDER': return 'notOnline';
    case 'BAD_CHECKOUT': return 'bad';
    default: return 'other';
  }
}
