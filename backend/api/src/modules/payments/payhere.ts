import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PayHere Checkout API and Payment Notification, as pure functions
 * (owner, 2026-10-14; https://support.payhere.lk/ - Checkout API, notify_url).
 *
 *   checkout hash = UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(merchant_secret))))
 *   md5sig        = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(merchant_secret))))
 *
 * `amount` is formatted with exactly two decimals and no thousands separator
 * (PHP number_format($amount, 2, '.', '')). Nothing here talks to PayHere.
 */

export type PayHereMode = 'sandbox' | 'live';

export const PAYHERE_CHECKOUT_URLS: Record<PayHereMode, string> = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
};

export const PAYHERE_CURRENCY = 'LKR';

/** PayHere status_code values (Payment Notification). */
export const PAYHERE_STATUS = {
  SUCCESS: 2,
  PENDING: 0,
  CANCELLED: -1,
  FAILED: -2,
  CHARGEDBACK: -3,
} as const;

export function md5Upper(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();
}

/** 1234.5 -> "1234.50"; rounds half away from zero on the cent like number_format. */
export function formatPayHereAmount(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid amount');
  // Work in integer cents so 1.005 style floats do not drift.
  const cents = Math.round(Number((n * 100).toFixed(6)));
  return (cents / 100).toFixed(2);
}

export function checkoutHash(p: {
  merchantId: string;
  orderId: string;
  amount: number | string;
  currency: string;
  merchantSecret: string;
}): string {
  return md5Upper(p.merchantId + p.orderId + formatPayHereAmount(p.amount) + p.currency + md5Upper(p.merchantSecret));
}

/** The md5sig PayHere sends with a notification, from the RAW posted strings. */
export function notifySignature(p: {
  merchantId: string;
  orderId: string;
  payhereAmount: string;
  payhereCurrency: string;
  statusCode: string;
  merchantSecret: string;
}): string {
  return md5Upper(p.merchantId + p.orderId + p.payhereAmount + p.payhereCurrency + p.statusCode + md5Upper(p.merchantSecret));
}

/** Constant-time comparison of the posted md5sig with the expected one. */
export function verifyNotifySignature(
  posted: { merchant_id: string; order_id: string; payhere_amount: string; payhere_currency: string; status_code: string; md5sig: string },
  merchantSecret: string
): boolean {
  const expected = notifySignature({
    merchantId: posted.merchant_id,
    orderId: posted.order_id,
    payhereAmount: posted.payhere_amount,
    payhereCurrency: posted.payhere_currency,
    statusCode: posted.status_code,
    merchantSecret,
  });
  const given = Buffer.from(String(posted.md5sig ?? '').toUpperCase(), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Splits a full name into PayHere's first_name / last_name. */
export function splitName(fullName: string | null | undefined): { first_name: string; last_name: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: 'Blynk', last_name: 'Customer' };
  if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
