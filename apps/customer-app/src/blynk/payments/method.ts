import { validEmail } from '@/blynk/api/account';
import type { OnlinePaymentInfo } from '@/blynk/api/types';
import { PAY } from './copy';

export { validEmail };

/*
 * Which payment methods checkout offers (docs/api/payhere.md): cash on delivery always; "Pay
 * online" only while GET /store (or checkout-info) says online_payment.enabled and there is
 * something to pay (a total of 0 after discounts/points is refused online: NOTHING_TO_PAY_ONLINE).
 */

export type PayMethod = 'COD' | 'ONLINE';

/** checkout-info's answer wins over GET /store's (it is fresher and per customer). */
export function onlineInfo(store: OnlinePaymentInfo | null | undefined, quote?: OnlinePaymentInfo | null): OnlinePaymentInfo | null {
  return quote ?? store ?? null;
}

export const onlineOffered = (info: OnlinePaymentInfo | null | undefined) => info?.enabled === true;

export type PayOption = { method: PayMethod; title: string; sub: string; enabled: boolean };

/**
 * The two rows of the payment choice (online only while offered). `nothingNote` replaces the
 * "nothing to pay online" line (e.g. the Blynk Wallet covers the order).
 */
export function payOptions(info: OnlinePaymentInfo | null | undefined, toPay: number | null, nothingNote?: string): PayOption[] {
  const rows: PayOption[] = [{ method: 'COD', title: PAY.cod, sub: PAY.codSub, enabled: true }];
  if (onlineOffered(info)) {
    const nothing = toPay !== null && toPay <= 0;
    rows.push({
      method: 'ONLINE',
      title: PAY.online,
      sub: nothing ? (nothingNote ?? PAY.nothingToPay) : (info?.methods_note?.trim() || PAY.onlineSubDefault),
      enabled: !nothing,
    });
  }
  return rows;
}

/** What the order is placed with: the customer's choice while it is allowed, else cash on delivery. */
export function effectiveMethod(chosen: PayMethod, info: OnlinePaymentInfo | null | undefined, toPay: number | null): PayMethod {
  if (chosen !== 'ONLINE' || !onlineOffered(info)) return 'COD';
  if (toPay !== null && toPay <= 0) return 'COD';
  return 'ONLINE';
}

/** The POST /orders addition: nothing for cash on delivery (the server's default). */
export const methodBody = (m: PayMethod): { payment_method?: 'ONLINE' } => (m === 'ONLINE' ? { payment_method: 'ONLINE' } : {});

/** "Pay within 20 minutes…" under the online row. */
export const windowNote = (info: OnlinePaymentInfo | null | undefined) =>
  info && Number.isFinite(info.payment_window_minutes) && info.payment_window_minutes > 0 ? PAY.window(info.payment_window_minutes) : null;

/* ---- the email PayHere needs ---- */

/**
 * Before paying: no email on the profile -> ask for one. Customers save it to their account
 * (PATCH /me); other roles (staff shopping with their number) cannot change it there, so it is
 * only put in the PayHere form.
 */
export function emailStep(profileEmail: string | null | undefined, role: string | null | undefined): 'none' | 'askAndSave' | 'askOnly' {
  if (profileEmail && validEmail(profileEmail)) return 'none';
  return (role ?? 'CUSTOMER') === 'CUSTOMER' ? 'askAndSave' : 'askOnly';
}
