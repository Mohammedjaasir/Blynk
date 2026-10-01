import { ApiError } from '../api/client';
import type { DeliverySummary, OrderStatus } from '../api/types';
import { formatMoney } from './orders';
import { errorCode } from './errors';

/**
 * What the operator can do next with a delivery, mirroring the backend's
 * rules (backend/api/src/modules/riders/rider.repository.ts and the shared
 * lifecycle catalogue). Ported from apps/rider/src/lib/delivery.ts (a fresh
 * implementation, not an import - common.md rule 2): this decides which
 * button is shown, nothing else. The API re-checks every step under row
 * locks and the screens handle its refusals when this view is out of date.
 */
export type RiderAction =
  | { kind: 'pickUp'; label: 'Picked up' }
  | { kind: 'arrive'; label: "I've arrived" }
  | { kind: 'collect'; label: string; amount: number }
  | {
      kind: 'none';
      reason: 'being-packed' | 'cancelled' | 'failed' | 'done' | 'not-cod' | 'check-store';
    };

const FAILED_ORDER: OrderStatus[] = ['FAILED', 'CUSTOMER_UNAVAILABLE'];

/**
 * The subset of a delivery's fields `nextAction`/`statusLabel` actually read
 * - lets Home's deliberately minimal `MyDelivery` (F2) share this logic with
 * Queue/Detail's full `DeliverySummary` (F4) without widening `MyDelivery`
 * into a duplicate of `DeliverySummary` (design-audit I5).
 */
export type DeliveryLike = Pick<DeliverySummary, 'assignment_status' | 'order_status' | 'payment_method' | 'payment_status' | 'total_amount'>;

export function nextAction(d: DeliveryLike): RiderAction {
  if (d.assignment_status === 'DELIVERED' || d.order_status === 'DELIVERED') return { kind: 'none', reason: 'done' };
  if (d.order_status === 'CANCELLED') return { kind: 'none', reason: 'cancelled' };
  if (d.assignment_status === 'FAILED' || d.assignment_status === 'REJECTED' || FAILED_ORDER.includes(d.order_status)) {
    return { kind: 'none', reason: 'failed' };
  }

  switch (d.assignment_status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      if (d.order_status === 'PACKED') return { kind: 'pickUp', label: 'Picked up' };
      if (d.order_status === 'PLACED' || d.order_status === 'ITEM_UNAVAILABLE') {
        return { kind: 'none', reason: 'being-packed' };
      }
      break;
    case 'PICKED_UP':
      if (d.order_status === 'OUT_FOR_DELIVERY') return { kind: 'arrive', label: "I've arrived" };
      break;
    case 'ARRIVED_AT_CUSTOMER':
      if (d.order_status === 'OUT_FOR_DELIVERY') {
        if (d.payment_method !== 'COD' || d.payment_status !== 'PENDING') return { kind: 'none', reason: 'not-cod' };
        return { kind: 'collect', label: `Collect ${formatMoney(d.total_amount)}`, amount: d.total_amount };
      }
      break;
  }
  // A combination the backend should never produce: don't guess an action.
  return { kind: 'none', reason: 'check-store' };
}

/** 0 pick up · 1 on the way · 2 handover · 3 delivered. */
export function stage(d: DeliverySummary): 0 | 1 | 2 | 3 {
  switch (d.assignment_status) {
    case 'PICKED_UP':
      return 1;
    case 'ARRIVED_AT_CUSTOMER':
      return 2;
    case 'DELIVERED':
      return 3;
    default:
      return 0;
  }
}

/** "Can't deliver" exists only once the order is on the road (backend: FAILED from PICKED_UP/ARRIVED). */
export function canReportFailure(d: DeliverySummary): boolean {
  return (
    (d.assignment_status === 'PICKED_UP' || d.assignment_status === 'ARRIVED_AT_CUSTOMER') &&
    d.order_status === 'OUT_FOR_DELIVERY'
  );
}

/**
 * The window in which this device may share its location: the backend's own
 * check (`rider.location.service.ts`: assignment `PICKED_UP`, order
 * `OUT_FOR_DELIVERY`), re-checked server-side on every write - never trusted
 * from a client-side "I pressed start" flag (common.md rule 10, this task's
 * brief). Deliberately narrower than `canReportFailure`: tracking ends on
 * arrival, the failure button does not.
 */
export function isTrackable(d: DeliverySummary): boolean {
  return d.assignment_status === 'PICKED_UP' && d.order_status === 'OUT_FOR_DELIVERY';
}

export interface Queue {
  /** The one delivery to act on now, if any. */
  now: DeliverySummary | null;
  /** Everything else still assigned, in the API's order (oldest assignment first). */
  next: DeliverySummary[];
  /** Delivered today. */
  done: DeliverySummary[];
  /** Cash settled today - the backend only settles the exact order total. */
  collectedToday: number;
}

/**
 * NOW is the delivery furthest along: at the door, then on the road, then the
 * oldest one ready to pick up. Nothing is "now" if every assignment is still
 * being packed or was closed.
 */
export function splitQueue(list: DeliverySummary[]): Queue {
  const isDone = (d: DeliverySummary) => {
    const action = nextAction(d);
    return action.kind === 'none' && action.reason === 'done';
  };
  const done = list.filter(isDone);
  const open = list.filter((d) => !done.includes(d));
  const now =
    open.find((d) => nextAction(d).kind === 'collect') ??
    open.find((d) => nextAction(d).kind === 'arrive') ??
    open.find((d) => nextAction(d).kind === 'pickUp') ??
    null;
  return {
    now,
    next: open.filter((d) => d !== now),
    done,
    collectedToday: done.reduce((sum, d) => sum + d.total_amount, 0),
  };
}

/** The operator-facing word for where a delivery stands. */
export function statusLabel(d: DeliveryLike): string {
  const action = nextAction(d);
  switch (action.kind) {
    case 'pickUp':
      return 'Ready to pick up';
    case 'arrive':
      return 'On the way';
    case 'collect':
      return 'At the door';
    case 'none':
      return NONE_LABEL[action.reason];
  }
}

const NONE_LABEL: Record<Extract<RiderAction, { kind: 'none' }>['reason'], string> = {
  'being-packed': 'Being packed',
  cancelled: "Cancelled — don't pick up",
  failed: "Couldn't deliver",
  done: 'Delivered',
  'not-cod': 'Check payment with the store',
  'check-store': 'Check with the store',
};

/** How loudly a status should read: go (act), wait (store's turn), stop (don't deliver). */
export function statusTone(d: DeliverySummary): 'go' | 'wait' | 'stop' | 'done' {
  const action = nextAction(d);
  if (action.kind !== 'none') return 'go';
  if (action.reason === 'done') return 'done';
  if (action.reason === 'being-packed') return 'wait';
  return 'stop';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A refused proof-of-delivery code (backend migration 016) in the operator's
 * words, or null when the error is about something else. Shown under the
 * code field, not as a page notice: the dialog stays open for another try.
 * `locked` is true while no code can be tried (5 wrong codes, 15 minutes).
 */
export function deliveryCodeError(err: unknown): { message: string; locked: boolean } | null {
  if (!(err instanceof ApiError)) return null;
  const details = (err.details ?? {}) as { attempts_remaining?: number; retry_after_seconds?: number; locked_until?: string };
  const minutesUntil = () => {
    const seconds =
      typeof details.retry_after_seconds === 'number'
        ? details.retry_after_seconds
        : details.locked_until
          ? (new Date(details.locked_until).getTime() - Date.now()) / 1000
          : 15 * 60;
    return Math.max(1, Math.ceil(seconds / 60));
  };
  switch (err.code) {
    case 'WRONG_DELIVERY_CODE': {
      const left = details.attempts_remaining;
      if (typeof left === 'number' && left <= 0) {
        return {
          message: `That code doesn't match. Too many wrong codes. Try again in ${plural(minutesUntil(), 'minute', 'minutes')}.`,
          locked: true,
        };
      }
      return {
        message: typeof left === 'number' ? `That code doesn't match. ${plural(left, 'try', 'tries')} left.` : "That code doesn't match.",
        locked: false,
      };
    }
    case 'DELIVERY_CODE_LOCKED':
      return { message: `Too many wrong codes. Try again in ${plural(minutesUntil(), 'minute', 'minutes')}.`, locked: true };
    case 'DELIVERY_CODE_NOT_ISSUED':
      return { message: 'This order has no delivery code. Ask the store to mark it delivered.', locked: true };
    default:
      return null;
  }
}

/**
 * The API's refusals in the operator's words, for the Delivery screens
 * (mirrors apps/rider/src/lib/errors.ts's `MESSAGES` map plus `lib/orders.ts`'s
 * own `orderErrorMessage` pattern - a per-domain message map, not a shared
 * one, matching F3's established convention). `RIDER_PROFILE_NOT_FOUND`/
 * `RIDER_INACTIVE` are handled separately by the pages themselves (they
 * re-probe `AuthContext`'s `riderCapability` rather than show a generic
 * message - see Queue.tsx/Detail.tsx), so they are included here only as a
 * safe fallback text, never relied on as the primary handling path.
 */
export function deliveryErrorMessage(err: unknown): string {
  const code = errorCode(err);
  switch (code) {
    case 'DELIVERY_NOT_FOUND':
      return 'This delivery is no longer assigned to you.';
    case 'INVALID_DELIVERY_TRANSITION':
      return 'This delivery changed. Showing the latest.';
    case 'COD_ALREADY_COLLECTED':
      return 'Cash for this order is already recorded.';
    case 'INVALID_COD_AMOUNT':
      return 'The amount to collect changed. Showing the latest total.';
    case 'NOT_COD_ORDER':
      return 'This order is not cash on delivery. Check with the store.';
    case 'ORDER_NOT_ACTIVE':
      return 'This order was cancelled or closed. Do not deliver it.';
    case 'RIDER_PROFILE_NOT_FOUND':
      return 'No rider profile is linked to this account.';
    case 'RIDER_INACTIVE':
      return "This account's rider profile isn't active.";
    case 'VALIDATION_ERROR':
      return 'Check what you entered and try again.';
    case 'FORBIDDEN':
      return 'Your account is not allowed to do this.';
    case 'NETWORK':
      return "You're offline. Nothing was sent. Try again when you have signal.";
    case 'TIMEOUT':
      return "The server didn't answer. Check the delivery before trying again.";
    default:
      if (err instanceof ApiError) {
        return err.status >= 500 ? 'The Blynk API had a problem. Try again in a moment.' : err.message;
      }
      return 'Something went wrong. Please try again.';
  }
}
