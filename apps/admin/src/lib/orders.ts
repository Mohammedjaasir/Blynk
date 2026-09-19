import { ApiError } from '../api/client';
import type { UserRole } from '../api/types';

/**
 * Display rules for the Orders board. They mirror the backend lifecycle
 * catalogue (backend/api/src/modules/orders/lifecycle/catalogue.ts) so staff
 * are only offered steps that can succeed. They decide nothing: the API
 * re-checks every step under its locks, and the board shows its refusals.
 */
export type OrderStatus =
  | 'PLACED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE';

export interface ItemsSummary {
  total: number;
  pending: number;
  sourced: number;
  packed: number;
  unavailable: number;
  substituted: number;
}

export interface ActiveDelivery {
  id: string;
  assignment_status: string;
  rider_id: string;
  rider_name: string | null;
}

/** The fields of an order these rules read. */
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

/** D7: nothing still to source, no unsourced substitution, something in the bag. */
export function isPackable({ items_summary: s }: BoardOrderLike): boolean {
  return s.pending === 0 && s.substituted === 0 && s.sourced + s.packed > 0;
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

const STORE: UserRole[] = ['ADMIN', 'PACKING_STAFF'];
const ADMIN: UserRole[] = ['ADMIN'];

/** [action, order states, roles, extra condition] - the catalogue rows staff can trigger. */
const RULES: ReadonlyArray<[OrderAction, OrderStatus[], UserRole[], (o: BoardOrderLike) => boolean]> = [
  ['pack', ['PLACED', 'ITEM_UNAVAILABLE'], STORE, () => true],
  ['assign', ['PACKED'], ADMIN, (o) => !o.active_delivery],
  [
    'handOver',
    ['PACKED'],
    STORE,
    (o) => o.active_delivery?.assignment_status === 'ASSIGNED' || o.active_delivery?.assignment_status === 'ACCEPTED',
  ],
  ['markDelivered', ['OUT_FOR_DELIVERY'], ADMIN, () => true],
  ['markFailed', ['OUT_FOR_DELIVERY'], ADMIN, () => true],
  ['markCustomerUnavailable', ['OUT_FOR_DELIVERY'], ADMIN, () => true],
  ['restage', ['FAILED', 'CUSTOMER_UNAVAILABLE'], ADMIN, () => true],
  ['cancel', ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'], ADMIN, () => true],
];

export function allowedActions(order: BoardOrderLike, role: UserRole | undefined): OrderAction[] {
  if (!role) return [];
  return RULES.filter(([, states, roles, when]) => states.includes(order.order_status) && roles.includes(role) && when(order)).map(
    ([action]) => action
  );
}

/** The one next step a row offers (yellow), or null when the next move isn't this role's. */
export function primaryAction(order: BoardOrderLike, role: UserRole | undefined): OrderAction | null {
  const allowed = allowedActions(order, role);
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

/** Order numbers are long; staff say the tail. "BL-20260919-0042" → "0042". */
export const shortNumber = (orderNumber: string) => orderNumber.split('-').pop() ?? orderNumber;

const money = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 });
export const formatMoney = (value: number) => `Rs. ${money.format(value)}`;

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
/** Store-local clock time (Asia/Colombo). */
export const formatClock = (iso: string | Date) => clock.format(typeof iso === 'string' ? new Date(iso) : iso);

export const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: 'To source',
  SOURCED: 'Sourced',
  PACKED: 'Packed',
  UNAVAILABLE: 'Unavailable',
  SUBSTITUTED: 'Substituted',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The API's refusals in the operator's words. */
export function orderErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Nothing was changed.';
  const details = (err.details ?? {}) as Record<string, any>;
  switch (err.code) {
    case 'ORDER_NOT_PACKABLE':
      if (details.pending > 0) return `Something changed: ${plural(details.pending, 'item')} still to source.`;
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
    case 'TRANSITION_NOT_PERMITTED_FOR_ROLE':
    case 'FORBIDDEN':
      return 'Your account cannot make this change.';
    case 'VALIDATION_ERROR':
      return 'Add a note and try again.';
    case 'NETWORK':
      return 'Could not reach the Blynk API. Nothing was changed.';
    default:
      return err.status >= 500 ? 'The Blynk API had a problem. Try again in a moment.' : err.message;
  }
}
