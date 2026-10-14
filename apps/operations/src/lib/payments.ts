import { ApiError } from '../api/client';
import type { PaymentMethod, PaymentStatus } from '../api/types';
import { catalogErrorMessage } from './catalog';
import type { Tone } from '../components/ui';

/**
 * How an order's money stands, in the staff apps' shared words
 * (docs/api/payhere.md §5). Pure: the screens only render what this returns.
 */
export interface PaymentLabel {
  text: string;
  tone: Tone;
}

export interface PaymentLike {
  payment_method?: PaymentMethod | string | null;
  payment_status?: PaymentStatus | string | null;
}

export function paymentLabel(order: PaymentLike): PaymentLabel | null {
  const method = order.payment_method;
  const status = order.payment_status;
  if (!method && !status) return null;
  // A chargeback reads the same whichever way the order was paid.
  if (status === 'REFUNDED') return { text: 'Refunded / chargeback', tone: 'bad' };
  if (method === 'ONLINE') {
    if (status === 'PAID') return { text: 'Paid online', tone: 'ok' };
    if (status === 'FAILED') return { text: 'Payment failed', tone: 'bad' };
    return { text: 'Payment pending', tone: 'warn' };
  }
  // COD (the default when an older API leaves the method out).
  if (status === 'PAID') return { text: 'Cash collected', tone: 'ok' };
  return { text: 'Cash on delivery', tone: 'muted' };
}

/** An ONLINE order PayHere has confirmed: the rider collects no cash. */
export const isPaidOnline = (order: PaymentLike) => order.payment_method === 'ONLINE' && order.payment_status === 'PAID';

export const REFUND_NEEDED = 'Refund needed';

export const refundNeeded = (order: { payment?: { refund_required?: boolean } | null }) => order.payment?.refund_required === true;

/** The PayHere settings card's refusals in the operator's words. */
export const PAYMENT_GATEWAY_MESSAGES: Record<string, string> = {
  PAYMENT_SECRET_KEY_MISSING:
    "The server has no PAYMENT_SECRET_KEY, so the merchant secret can't be saved. Ask whoever runs the server to set it, then try again.",
  PAYHERE_NOT_CONFIGURED: 'PayHere is not set up yet. An Admin must save the merchant ID and merchant secret first.',
  CREDENTIALS_ADMIN_ONLY: 'Only an Admin can change PayHere credentials.',
};

export function paymentGatewayErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && PAYMENT_GATEWAY_MESSAGES[err.code]) return PAYMENT_GATEWAY_MESSAGES[err.code];
  return catalogErrorMessage(err);
}

/** The window the API accepts (5-180 minutes). */
export function parseWindowMinutes(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return { error: 'Enter the payment window in whole minutes (5 to 180).' };
  const value = Number(s);
  if (value < 5 || value > 180) return { error: 'The payment window must be 5 to 180 minutes.' };
  return { value };
}
