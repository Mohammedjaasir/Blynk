import { ApiError } from '../api/client';

/**
 * Payment display rules for staff (docs/api/payhere.md section 5). Pure:
 * they decide nothing, the API owns the payment state.
 */
export type PaymentMethod = 'COD' | 'ONLINE';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export type PaymentTone = 'cash' | 'paid' | 'pending' | 'failed' | 'refunded' | 'muted';

export interface PaymentLabel {
  text: string;
  tone: PaymentTone;
}

/** The fields of an order these rules read. */
export interface PaymentLike {
  payment_method?: PaymentMethod | string | null;
  payment_status?: PaymentStatus | string | null;
}

/**
 * COD+PENDING "Cash on delivery", COD+PAID "Cash collected", ONLINE+PAID
 * "Paid online", ONLINE+PENDING "Payment pending", ONLINE+FAILED "Payment
 * failed", REFUNDED (either method) "Refunded / chargeback". Null when the
 * API sent no payment method (an older API).
 */
export function paymentLabel(order: PaymentLike): PaymentLabel | null {
  const method = order.payment_method;
  const status = order.payment_status;
  if (!method) return null;
  if (status === 'REFUNDED') return { text: 'Refunded / chargeback', tone: 'refunded' };
  if (method === 'COD') {
    if (status === 'PAID') return { text: 'Cash collected', tone: 'paid' };
    return { text: 'Cash on delivery', tone: 'cash' };
  }
  if (method === 'ONLINE') {
    if (status === 'PAID') return { text: 'Paid online', tone: 'paid' };
    if (status === 'FAILED') return { text: 'Payment failed', tone: 'failed' };
    return { text: 'Payment pending', tone: 'pending' };
  }
  return { text: String(method), tone: 'muted' };
}

export const REFUND_NEEDED_LABEL = 'Refund needed';

/** True when staff must refund this order by hand (contract section 2). */
export function refundNeeded(order: { payment?: { refund_required?: boolean | null } | null }): boolean {
  return Boolean(order.payment?.refund_required);
}

/** "Visa" from "VISA"; PayHere sends methods in capitals. */
export function gatewayMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  const known: Record<string, string> = { VISA: 'Visa', MASTER: 'Mastercard', MASTERCARD: 'Mastercard', AMEX: 'American Express', EZCASH: 'eZ Cash', MCASH: 'mCash', GENIE: 'Genie', VISHWA: 'Vishwa', PAYAPP: 'PayApp', HNB: 'HNB', FRIMI: 'FriMi' };
  return known[method.toUpperCase()] ?? method;
}

/** The PayHere settings refusals in the operator's words (contract section 5). */
export function paymentGatewayErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case 'PAYMENT_SECRET_KEY_MISSING':
      return 'The server is missing PAYMENT_SECRET_KEY, so the merchant secret cannot be saved. Ask the developer to set it, then try again.';
    case 'PAYHERE_NOT_CONFIGURED':
      return 'PayHere is not configured yet: save the merchant ID and merchant secret first.';
    case 'CREDENTIALS_ADMIN_ONLY':
      return 'Only an Admin can change the PayHere credentials.';
    default:
      return null;
  }
}
