import { ApiError } from '../api/client';
import type { ActiveDelivery, ItemsSummary, OrderDetail, OrderStatus } from '../api/types';

/**
 * Display rules for the Orders board/detail (plan §10). They mirror the
 * backend lifecycle catalogue (backend/api/src/modules/orders/lifecycle/
 * catalogue.ts) so the operator is only offered steps that can succeed. They
 * decide nothing: the API re-checks every step under its locks, and the
 * board/detail page shows its refusals. Ported from
 * apps/admin/src/lib/orders.ts (a fresh implementation, not an import - see
 * common.md rule 2), with one structural difference: the Operations operator
 * always holds `role='ADMIN'` (common.md's OPS-04/scope decision), so unlike
 * Admin's table - which also gates by `PACKING_STAFF` vs `ADMIN` - there is
 * no role dimension here. Every rule below is exactly the set of actions
 * Admin's own table allows an `ADMIN` row; gating still happens by order
 * *status* (and, where relevant, active-delivery state), never invented.
 */

/** The fields these rules read. `OrderStatus` is Operations' own type
 * (api/types.ts, added by F2) - reused here rather than redeclared, since a
 * second copy would drift from BoardOrder/OrderDetail's own field type. */
export interface BoardOrderLike {
  order_status: OrderStatus;
  items_summary: ItemsSummary;
  active_delivery: ActiveDelivery | null;
}

export type Lane = 'attention' | 'toPack' | 'readyForRider' | 'waitingPickup' | 'onTheRoad' | 'done';

/** Lanes in the order work flows through the store; exceptions first. */
export const LANES: ReadonlyArray<{ id: Lane; title: string; empty: string }> = [
  { id: 'attention', title: 'Needs attention', empty: 'Nothing needs attention.' },
  { id: 'toPack', title: 'To pack', empty: 'Nothing waiting to be packed.' },
  { id: 'readyForRider', title: 'Ready for a rider', empty: 'No packed orders waiting for a rider.' },
  { id: 'waitingPickup', title: 'Waiting for pickup', empty: 'No rider is waiting at the counter.' },
  { id: 'onTheRoad', title: 'On the road', empty: 'No deliveries on the road.' },
];

export function laneOf(order: BoardOrderLike): Lane {
  switch (order.order_status) {
    case 'ITEM_UNAVAILABLE':
    case 'FAILED':
    case 'CUSTOMER_UNAVAILABLE':
      return 'attention';
    case 'PLACED':
      return 'toPack';
    case 'PACKED':
      return order.active_delivery ? 'waitingPickup' : 'readyForRider';
    case 'OUT_FOR_DELIVERY':
      return 'onTheRoad';
    default:
      return 'done';
  }
}

/** Substitutions that still need a cost before the order can be packed. */
export function uncostedSubstitutions(s: ItemsSummary): number {
  return s.uncosted_substitutions ?? s.substituted;
}

/**
 * D7, revised 2026-09-30 (the owner: no separate sourcing step): the pack
 * itself takes every pending item off the shelf, so an order packs straight
 * from Placed - as long as there is no substitution without a cost and
 * something is left in the bag (backend `packingBlockers`; a substitution
 * with its cost counts as in the bag). Mirrors apps/admin/src/lib/orders.ts.
 */
export function isPackable({ items_summary: s }: BoardOrderLike): boolean {
  const uncosted = uncostedSubstitutions(s);
  return uncosted === 0 && s.pending + s.sourced + s.packed + (s.substituted - uncosted) > 0;
}

export type OrderAction =
  | 'pack'
  | 'assign'
  | 'handOver'
  | 'markDelivered'
  | 'markFailed'
  | 'markCustomerUnavailable'
  | 'restage'
  | 'cancel';

/** [action, order states, extra condition] - the catalogue rows an ADMIN
 * operator can trigger (no role dimension - see the file doc comment). */
const RULES: ReadonlyArray<[OrderAction, OrderStatus[], (o: BoardOrderLike) => boolean]> = [
  ['pack', ['PLACED', 'ITEM_UNAVAILABLE'], () => true],
  ['assign', ['PACKED'], (o) => !o.active_delivery],
  [
    'handOver',
    ['PACKED'],
    (o) => o.active_delivery?.assignment_status === 'ASSIGNED' || o.active_delivery?.assignment_status === 'ACCEPTED',
  ],
  ['markDelivered', ['OUT_FOR_DELIVERY'], () => true],
  ['markFailed', ['OUT_FOR_DELIVERY'], () => true],
  ['markCustomerUnavailable', ['OUT_FOR_DELIVERY'], () => true],
  ['restage', ['FAILED', 'CUSTOMER_UNAVAILABLE'], () => true],
  ['cancel', ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'], () => true],
];

export function allowedActions(order: BoardOrderLike): OrderAction[] {
  return RULES.filter(([, states, when]) => states.includes(order.order_status) && when(order)).map(([action]) => action);
}

/** The one next step a row offers (yellow), or null when nothing is offered. */
export function primaryAction(order: BoardOrderLike): OrderAction | null {
  const allowed = allowedActions(order);
  const next: OrderAction | null =
    order.order_status === 'PLACED' || order.order_status === 'ITEM_UNAVAILABLE'
      ? isPackable(order)
        ? 'pack'
        : null
      : order.order_status === 'PACKED'
        ? order.active_delivery
          ? 'handOver'
          : 'assign'
        : order.order_status === 'FAILED' || order.order_status === 'CUSTOMER_UNAVAILABLE'
          ? 'restage'
          : null;
  return next && allowed.includes(next) ? next : null;
}

export const ACTION_LABEL: Record<OrderAction, string> = {
  pack: 'Pack',
  assign: 'Assign rider',
  handOver: 'Handed to rider',
  markDelivered: 'Mark delivered',
  markFailed: 'Mark failed',
  markCustomerUnavailable: 'Customer unavailable',
  restage: 'Return to packed',
  cancel: 'Cancel order',
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Delivery failed',
  CUSTOMER_UNAVAILABLE: 'Customer unavailable',
  ITEM_UNAVAILABLE: 'Item unavailable',
};

/** How long an order has waited since it was placed ("23 min"). Real placed_at, no targets. */
export function formatAge(placedAt: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(placedAt).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Order numbers are long; the operator says the tail. "BL-20260919-0042" → "0042". */
export const shortNumber = (orderNumber: string) => orderNumber.split('-').pop() ?? orderNumber;

const money = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 });
export const formatMoney = (value: number) => `LKR ${money.format(value)}`;

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
/** Store-local clock time (Asia/Colombo). */
export const formatClock = (iso: string | Date) => clock.format(typeof iso === 'string' ? new Date(iso) : iso);

export const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: 'To pack',
  SOURCED: 'Ready to pack',
  PACKED: 'Packed',
  UNAVAILABLE: 'Unavailable',
  SUBSTITUTED: 'Substituted',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The API's refusals in the operator's words. */
export function orderErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Nothing was changed.';
  const details = (err.details ?? {}) as Record<string, any>;
  // (BATCH_DROPOFFS_TOO_FAR is normally answered inside the assign dialog -
  // see `farBatchRefusal` - this copy is its fallback.)
  switch (err.code) {
    case 'ORDER_NOT_PACKABLE':
      if (details.unsourced_substitutions > 0) {
        return `Something changed: ${plural(details.unsourced_substitutions, 'substitution')} still to source.`;
      }
      return 'Nothing is left to pack - every item is unavailable. Cancel the order instead.';
    case 'INVALID_STATUS_TRANSITION':
      return details.current_status
        ? `This order has moved on (now ${STATUS_LABEL[details.current_status as OrderStatus] ?? details.current_status}). Showing the latest.`
        : 'This order has moved on. Showing the latest.';
    case 'ORDER_ALREADY_ASSIGNED':
      return 'Another rider was just assigned to this order.';
    case 'ORDER_NOT_READY_FOR_ASSIGNMENT':
      return 'This order is no longer packed. Showing the latest.';
    case 'RIDER_INACTIVE':
      return 'That rider has been deactivated. Choose another rider.';
    case 'RIDER_AT_CAPACITY':
      return `That rider's trip is full (${details.max_active_deliveries ?? 2} orders). Choose another rider.`;
    case 'BATCH_DROPOFFS_TOO_FAR':
      return details.distance_km != null
        ? `This drop-off is ${details.distance_km} km from that rider's other one. Confirm to add it to the trip anyway.`
        : "How far this drop-off is from that rider's other one is unknown. Confirm to add it to the trip anyway.";
    case 'RIDER_NOT_FOUND':
      return 'That rider no longer exists. Choose another rider.';
    case 'NO_ACTIVE_DELIVERY':
      return 'No rider holds this order any more. Showing the latest.';
    case 'ACTIVE_DELIVERY_EXISTS':
      return 'A rider still holds this order. Mark the attempt failed first.';
    case 'ORDER_CHANGED':
      return 'This order changed while you were working. Showing the latest.';
    case 'COD_ALREADY_COLLECTED':
      return 'Cash for this order is already recorded.';
    case 'ITEM_ALREADY_SOURCED':
    case 'ITEM_ALREADY_RESOLVED':
    case 'ORDER_NOT_IN_SOURCING_STATE':
      return 'This item has already been packed or resolved. Showing the latest.';
    case 'INSUFFICIENT_TRACKED_INVENTORY':
      return details.product_name
        ? `Not enough ${details.product_name} in stock to pack this order (${details.on_hand ?? 0} on hand, ${details.requested} needed). Restock it or mark it unavailable.`
        : 'A product is short on stock. Restock it or mark it unavailable.';
    case 'TRANSITION_NOT_PERMITTED_FOR_ROLE':
    case 'FORBIDDEN':
      return 'Your account cannot make this change.';
    case 'VALIDATION_ERROR':
      return "Add a note (or the customer's delivery code) and try again.";
    case 'NETWORK':
      return 'Could not reach the Blynk API. Nothing was changed.';
    default:
      return err.status >= 500 ? 'The Blynk API had a problem. Try again in a moment.' : err.message;
  }
}

/** A delivery that still holds the order (mirrors the backend's own
 * `ACTIVE_DELIVERY_STATUSES`, backend/api/src/modules/orders/lifecycle/
 * catalogue.ts:140 - copied literally, not guessed). */
const ACTIVE_DELIVERY_STATUSES = new Set(['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER']);

/**
 * `GET /admin/orders/:id` doesn't return `items_summary`/`active_delivery`
 * the way the board's list query does (the detail endpoint has no reason to
 * pre-aggregate what its own `items[]`/`delivery` already carry in full) -
 * see `api/types.ts`'s `OrderDetail` doc comment. The Orders detail page is
 * a standalone, directly-linkable route (no guarantee the board's already-
 * loaded `BoardOrder` row is in memory, unlike Admin's slide-over panel,
 * which always has both), so it derives the same two aggregates client-side
 * from `OrderDetail`'s own real fields - the identical computation the
 * backend performs for the board query (counting `item_status`, and
 * checking `delivery.assignment_status` against the same active-status set)
 * - never a fabricated or guessed number (common.md rule 7).
 */
export function boardOrderLikeFromDetail(detail: OrderDetail): BoardOrderLike {
  const items_summary: ItemsSummary = {
    total: 0,
    pending: 0,
    sourced: 0,
    packed: 0,
    unavailable: 0,
    substituted: 0,
    uncosted_substitutions: 0,
  };
  for (const item of detail.items) {
    items_summary.total += 1;
    if (item.item_status === 'PENDING') items_summary.pending += 1;
    else if (item.item_status === 'SOURCED') items_summary.sourced += 1;
    else if (item.item_status === 'PACKED') items_summary.packed += 1;
    else if (item.item_status === 'UNAVAILABLE') items_summary.unavailable += 1;
    else if (item.item_status === 'SUBSTITUTED') {
      items_summary.substituted += 1;
      // The backend rule (isUncostedSubstitution): no recorded cost blocks
      // packing. A row without the field at all is treated the same way.
      if (item.actual_unit_cost === null || item.actual_unit_cost === undefined) items_summary.uncosted_substitutions! += 1;
    }
  }
  const d = detail.delivery;
  const active_delivery: ActiveDelivery | null =
    d && ACTIVE_DELIVERY_STATUSES.has(d.assignment_status)
      ? { id: d.id, assignment_status: d.assignment_status, rider_id: d.rider_id, rider_name: d.rider_name ?? null }
      : null;
  return { order_status: detail.order_status, items_summary, active_delivery };
}

/**
 * The assign-rider refusal that only needs a confirmation (409
 * BATCH_DROPOFFS_TOO_FAR: the drop-off is far from the rider's other one).
 * The dialog stays open and offers "Add to trip anyway" for that rider -
 * which matters most when the suggestions could not load and the plain
 * roster (no trip distances) was offered instead. Null for anything else.
 */
export interface FarBatchRefusal {
  riderId: string;
  message: string;
}

export function farBatchRefusal(err: unknown, riderId: string, confirmed: boolean): FarBatchRefusal | null {
  if (confirmed || !(err instanceof ApiError) || err.code !== 'BATCH_DROPOFFS_TOO_FAR') return null;
  return { riderId, message: orderErrorMessage(err) };
}
