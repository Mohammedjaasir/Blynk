import type { Order } from '@/blynk/orders/types';

/*
 * After PayHere (payment/return and payment/cancel): the browser's landing URL proves nothing.
 * The screen polls GET /orders/:id and only a verified PayHere notification (the order PLACED
 * + PAID) counts as paid. Pure, so the screen and the tests share it.
 */

export type PayPhase =
  /** First answer not in yet. */
  | 'checking'
  /** Still AWAITING_PAYMENT after a return: PayHere's notification may be on its way (keep polling). */
  | 'waiting'
  | 'paid'
  /** The last attempt failed (payment_status FAILED): try again until it expires. */
  | 'failed'
  /** Came back through cancel_url, still unpaid: pay now or later (until it expires). */
  | 'notPaid'
  /** Still waiting after the polling limit: check again (never pay twice blindly). */
  | 'timeout'
  /** Past payment_expires_at (or cancelled by the expiry worker). */
  | 'expired'
  | 'cancelled'
  /** A cash on delivery order: nothing to pay online. */
  | 'cod';

export const POLL = { everyMs: 2500, limitMs: 60_000 } as const;

type PayOrder = Pick<Order, 'order_status' | 'payment_method' | 'payment_status'> & Partial<Pick<Order, 'payment_expires_at'>>;

const expiredAt = (o: PayOrder, now: number) => {
  const t = o.payment_expires_at ? Date.parse(o.payment_expires_at) : NaN;
  return Number.isFinite(t) && now >= t;
};

export function phaseOf(o: PayOrder | null, ctx: { now: number; from: 'return' | 'cancel'; elapsedMs: number; limitMs?: number }): PayPhase {
  if (!o) return 'checking';
  const limit = ctx.limitMs ?? POLL.limitMs;
  if (o.payment_status === 'PAID' && o.order_status !== 'AWAITING_PAYMENT') return o.payment_method === 'ONLINE' ? 'paid' : 'cod';
  if (o.payment_method !== 'ONLINE') return o.order_status === 'CANCELLED' ? 'cancelled' : 'cod';
  if (o.order_status === 'CANCELLED') return expiredAt(o, ctx.now) ? 'expired' : 'cancelled';
  if (o.order_status === 'AWAITING_PAYMENT') {
    if (expiredAt(o, ctx.now)) return 'expired';
    if (o.payment_status === 'FAILED') return 'failed';
    if (ctx.from === 'cancel') return 'notPaid';
    return ctx.elapsedMs >= limit ? 'timeout' : 'waiting';
  }
  // moved on (PLACED, PACKED, ...) means a verified payment released it
  return 'paid';
}

/** Keep asking the server: still waiting for PayHere's notification (a cancel can race a late success). */
export const keepsPolling = (p: PayPhase) => p === 'checking' || p === 'waiting' || p === 'notPaid';

/** "Try again / Pay now" goes back through POST /payments/payhere/checkout (allowed until it expires). */
export const canPayAgain = (p: PayPhase) => p === 'failed' || p === 'notPaid';

export const isFinal = (p: PayPhase) => p === 'paid' || p === 'expired' || p === 'cancelled' || p === 'cod';

/**
 * One polling step: what to do after an answer (or a failed request). `stopAt` = the elapsed
 * time after which a waiting order shows "We haven't heard from PayHere yet".
 */
export function nextPoll(phase: PayPhase, elapsedMs: number, limitMs: number = POLL.limitMs): { again: boolean; delayMs: number } {
  if (!keepsPolling(phase) || elapsedMs >= limitMs) return { again: false, delayMs: 0 };
  return { again: true, delayMs: POLL.everyMs };
}
