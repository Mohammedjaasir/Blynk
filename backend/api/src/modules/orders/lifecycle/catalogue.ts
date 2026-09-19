import type { ItemFulfillmentStatus, OrderStatus, UserRole, DeliveryAssignmentStatus } from '../../../database/types.js';

/**
 * The canonical order lifecycle (dispatch plan §O.2), as data.
 *
 * Every change to orders.order_status in the system is one of these actions,
 * run by lifecycle/engine.ts. Sources: backend API architecture §G (transition
 * matrix), §H (assignment), §I (COD), §K (out-of-stock); business rules §5;
 * decisions D1-D15 approved 2026-09-19 (D6 = admin re-stage).
 */
export const ACTION_NAMES = [
  'CUSTOMER_CANCEL',
  'RESOLVE_ITEM',
  'PACK',
  'ASSIGN_RIDER',
  'HAND_TO_RIDER',
  'RIDER_PICKUP',
  'RIDER_ARRIVE',
  'RIDER_FAIL',
  'RIDER_COLLECT_COD',
  'ADMIN_MARK_DELIVERED',
  'ADMIN_MARK_FAILED',
  'ADMIN_MARK_CUSTOMER_UNAVAILABLE',
  'ADMIN_CANCEL',
  'RESTAGE',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/**
 * What an action locks, always before the order row (children first, then
 * the order, then inventory rows by ascending id, then the payment), so no two
 * actions can wait on each other in opposite orders. No action locks both
 * items and deliveries, or both inventory and payment rows.
 */
export type LockKind = 'order' | 'item' | 'allItems' | 'riderDelivery' | 'activeDeliveries';

export interface CatalogueEntry {
  action: ActionName;
  /** Order states in which the action is valid. */
  from: readonly OrderStatus[];
  /** Resulting order state, or null when the action leaves it unchanged. */
  to: OrderStatus | null;
  roles: readonly UserRole[];
  lock: LockKind;
  /** A staff note is mandatory (400 VALIDATION_ERROR without it). */
  notesRequired: boolean;
  /** Customer SMS outbox types this action enqueues. */
  notifications: readonly string[];
  /** What the action does to tracked stock (inventory plan §4). */
  stock: StockEffect;
}

/**
 * NONE: the action never touches inventory. RESTORE_ORDER_STOCK: the stock
 * this order took (its ledger net, inventory/stock-ledger.ts) goes back on
 * the shelf in the same transaction. Stock is taken only by sourcing.
 */
export type StockEffect = 'NONE' | 'RESTORE_ORDER_STOCK';

const STORE: readonly UserRole[] = ['ADMIN', 'PACKING_STAFF'];
const ADMIN: readonly UserRole[] = ['ADMIN'];
const RIDER: readonly UserRole[] = ['RIDER'];

export const CATALOGUE: Record<ActionName, CatalogueEntry> = {
  CUSTOMER_CANCEL: {
    action: 'CUSTOMER_CANCEL', from: ['PLACED', 'PACKED'], to: 'CANCELLED', roles: ['CUSTOMER'],
    lock: 'order', notesRequired: false, stock: 'RESTORE_ORDER_STOCK', notifications: ['ORDER_CANCELLED'],
  },
  RESOLVE_ITEM: {
    action: 'RESOLVE_ITEM', from: ['PLACED', 'ITEM_UNAVAILABLE'], to: 'ITEM_UNAVAILABLE', roles: STORE,
    lock: 'item', notesRequired: false, stock: 'NONE', notifications: ['ITEM_UNAVAILABLE'],
  },
  PACK: {
    action: 'PACK', from: ['PLACED', 'ITEM_UNAVAILABLE'], to: 'PACKED', roles: STORE,
    lock: 'allItems', notesRequired: false, stock: 'NONE', notifications: [],
  },
  ASSIGN_RIDER: {
    action: 'ASSIGN_RIDER', from: ['PACKED'], to: null, roles: ADMIN,
    lock: 'order', notesRequired: false, stock: 'NONE', notifications: ['RIDER_ASSIGNED'],
  },
  HAND_TO_RIDER: {
    action: 'HAND_TO_RIDER', from: ['PACKED'], to: 'OUT_FOR_DELIVERY', roles: STORE,
    lock: 'activeDeliveries', notesRequired: false, stock: 'NONE', notifications: ['OUT_FOR_DELIVERY'],
  },
  RIDER_PICKUP: {
    action: 'RIDER_PICKUP', from: ['PACKED'], to: 'OUT_FOR_DELIVERY', roles: RIDER,
    lock: 'riderDelivery', notesRequired: false, stock: 'NONE', notifications: ['OUT_FOR_DELIVERY'],
  },
  RIDER_ARRIVE: {
    action: 'RIDER_ARRIVE', from: ['OUT_FOR_DELIVERY'], to: null, roles: RIDER,
    lock: 'riderDelivery', notesRequired: false, stock: 'NONE', notifications: [],
  },
  RIDER_FAIL: {
    action: 'RIDER_FAIL', from: ['OUT_FOR_DELIVERY'], to: 'FAILED', roles: RIDER,
    lock: 'riderDelivery', notesRequired: false, stock: 'NONE', notifications: [],
  },
  RIDER_COLLECT_COD: {
    action: 'RIDER_COLLECT_COD', from: ['OUT_FOR_DELIVERY'], to: 'DELIVERED', roles: RIDER,
    lock: 'riderDelivery', notesRequired: false, stock: 'NONE', notifications: ['DELIVERED', 'COD_PAYMENT_CONFIRMED'],
  },
  ADMIN_MARK_DELIVERED: {
    action: 'ADMIN_MARK_DELIVERED', from: ['OUT_FOR_DELIVERY'], to: 'DELIVERED', roles: ADMIN,
    lock: 'activeDeliveries', notesRequired: true, stock: 'NONE', notifications: ['DELIVERED', 'COD_PAYMENT_CONFIRMED'],
  },
  ADMIN_MARK_FAILED: {
    action: 'ADMIN_MARK_FAILED', from: ['OUT_FOR_DELIVERY'], to: 'FAILED', roles: ADMIN,
    lock: 'activeDeliveries', notesRequired: true, stock: 'NONE', notifications: [],
  },
  ADMIN_MARK_CUSTOMER_UNAVAILABLE: {
    action: 'ADMIN_MARK_CUSTOMER_UNAVAILABLE', from: ['OUT_FOR_DELIVERY'], to: 'CUSTOMER_UNAVAILABLE', roles: ADMIN,
    lock: 'activeDeliveries', notesRequired: true, stock: 'NONE', notifications: [],
  },
  ADMIN_CANCEL: {
    action: 'ADMIN_CANCEL', from: ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'], to: 'CANCELLED', roles: ADMIN,
    lock: 'order', notesRequired: true, stock: 'RESTORE_ORDER_STOCK', notifications: ['ORDER_CANCELLED'],
  },
  RESTAGE: {
    action: 'RESTAGE', from: ['FAILED', 'CUSTOMER_UNAVAILABLE'], to: 'PACKED', roles: ADMIN,
    lock: 'activeDeliveries', notesRequired: true, stock: 'NONE', notifications: [],
  },
};

/** Status of a newly placed order (PLACE_ORDER). */
export const INITIAL_ORDER_STATUS: OrderStatus = 'PLACED';

/** Orders nobody may move any further along the delivery path. */
export const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'DELIVERED', 'FAILED', 'CUSTOMER_UNAVAILABLE'];

/** Order states in which items may still be sourced or resolved (D9). */
export const ITEM_WORK_STATES: readonly OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE'];

/** A delivery that still holds the order (uq_deliveries_active_assignment). */
export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'ARRIVED_AT_CUSTOMER',
];

/**
 * PATCH /admin/orders/:id/status: which action a requested status means.
 * null means no action produces that status from the admin endpoint (422).
 * The chosen action re-checks the state under its locks.
 */
export function adminStatusAction(target: OrderStatus, current: OrderStatus): ActionName | null {
  switch (target) {
    case 'PACKED':
      return current === 'FAILED' || current === 'CUSTOMER_UNAVAILABLE' ? 'RESTAGE' : 'PACK';
    case 'OUT_FOR_DELIVERY':
      return 'HAND_TO_RIDER';
    case 'DELIVERED':
      return 'ADMIN_MARK_DELIVERED';
    case 'FAILED':
      return 'ADMIN_MARK_FAILED';
    case 'CUSTOMER_UNAVAILABLE':
      return 'ADMIN_MARK_CUSTOMER_UNAVAILABLE';
    case 'CANCELLED':
      return 'ADMIN_CANCEL';
    default:
      return null;
  }
}

export interface PackingBlockers {
  pending: number;
  unsourced_substitutions: number;
  packable_items: number;
}

/**
 * D7, from "items sourced & bagged; actual procurement cost recorded": no
 * item still to source, no substitution without a recorded cost, and at least
 * one item actually in the bag. Returns null when the order can be packed.
 */
export function packingBlockers(
  items: ReadonlyArray<{ item_status: ItemFulfillmentStatus; actual_unit_cost: unknown }>
): PackingBlockers | null {
  const pending = items.filter((i) => i.item_status === 'PENDING').length;
  const unsourcedSubstitutions = items.filter(
    (i) => i.item_status === 'SUBSTITUTED' && (i.actual_unit_cost === null || i.actual_unit_cost === undefined)
  ).length;
  const packable = items.filter(
    (i) =>
      i.item_status === 'SOURCED' ||
      i.item_status === 'PACKED' ||
      (i.item_status === 'SUBSTITUTED' && i.actual_unit_cost !== null && i.actual_unit_cost !== undefined)
  ).length;
  if (pending === 0 && unsourcedSubstitutions === 0 && packable > 0) return null;
  return { pending, unsourced_substitutions: unsourcedSubstitutions, packable_items: packable };
}
