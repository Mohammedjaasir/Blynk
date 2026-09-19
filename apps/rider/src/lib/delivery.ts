import type { DeliverySummary, OrderStatus } from '../api/types';
import { formatMoney } from './format';

/**
 * What the rider can do next with a delivery, mirroring the backend's rules
 * (modules/riders/rider.repository.ts). This decides which button is shown;
 * it decides nothing else. The API re-checks every step under row locks and
 * the screens handle its refusals when this view is out of date.
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

export function nextAction(d: DeliverySummary): RiderAction {
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

/** The rider-facing word for where a delivery stands. */
export function statusLabel(d: DeliverySummary): string {
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
