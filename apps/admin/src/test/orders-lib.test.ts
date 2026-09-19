import { describe, it, expect } from 'vitest';
import { allowedActions, formatAge, isPackable, laneOf, primaryAction, type BoardOrderLike } from '../lib/orders';

/**
 * The Orders board's display rules. They mirror the backend lifecycle
 * catalogue (plan §O.2) so staff are only offered actions that can succeed;
 * the API re-checks every one under its locks.
 */
const order = (overrides: Partial<BoardOrderLike> = {}): BoardOrderLike => ({
  order_status: 'PLACED',
  items_summary: { total: 2, pending: 0, sourced: 2, packed: 0, unavailable: 0, substituted: 0 },
  active_delivery: null,
  ...overrides,
});
const withRider = (assignment_status: string) => ({
  id: 'd1',
  assignment_status,
  rider_id: 'r1',
  rider_name: 'Farhan Mohamed',
});

describe('laneOf', () => {
  it.each([
    [order({ order_status: 'ITEM_UNAVAILABLE' }), 'attention'],
    [order({ order_status: 'FAILED' }), 'attention'],
    [order({ order_status: 'CUSTOMER_UNAVAILABLE' }), 'attention'],
    [order({ order_status: 'PLACED' }), 'toPack'],
    [order({ order_status: 'PACKED' }), 'readyForRider'],
    [order({ order_status: 'PACKED', active_delivery: withRider('ASSIGNED') }), 'waitingPickup'],
    [order({ order_status: 'OUT_FOR_DELIVERY', active_delivery: withRider('PICKED_UP') }), 'onTheRoad'],
    [order({ order_status: 'DELIVERED' }), 'done'],
    [order({ order_status: 'CANCELLED' }), 'done'],
  ])('%#', (o, lane) => {
    expect(laneOf(o)).toBe(lane);
  });
});

describe('isPackable (D7)', () => {
  it('needs nothing pending, no unsourced substitution, and something in the bag', () => {
    expect(isPackable(order())).toBe(true);
    expect(isPackable(order({ items_summary: { total: 2, pending: 1, sourced: 1, packed: 0, unavailable: 0, substituted: 0 } }))).toBe(false);
    expect(isPackable(order({ items_summary: { total: 1, pending: 0, sourced: 0, packed: 0, unavailable: 0, substituted: 1 } }))).toBe(false);
    expect(isPackable(order({ items_summary: { total: 1, pending: 0, sourced: 0, packed: 0, unavailable: 1, substituted: 0 } }))).toBe(false);
    expect(isPackable(order({ items_summary: { total: 2, pending: 0, sourced: 1, packed: 0, unavailable: 1, substituted: 0 } }))).toBe(true);
  });
});

describe('allowedActions', () => {
  it.each([
    ['PLACED', null, 'ADMIN', ['pack', 'cancel']],
    ['PLACED', null, 'PACKING_STAFF', ['pack']],
    ['ITEM_UNAVAILABLE', null, 'ADMIN', ['pack', 'cancel']],
    ['PACKED', null, 'ADMIN', ['assign', 'cancel']],
    ['PACKED', null, 'PACKING_STAFF', []],
    ['PACKED', 'ASSIGNED', 'ADMIN', ['handOver', 'cancel']],
    ['PACKED', 'ASSIGNED', 'PACKING_STAFF', ['handOver']],
    ['OUT_FOR_DELIVERY', 'PICKED_UP', 'ADMIN', ['markDelivered', 'markFailed', 'markCustomerUnavailable']],
    ['OUT_FOR_DELIVERY', 'PICKED_UP', 'PACKING_STAFF', []],
    ['FAILED', null, 'ADMIN', ['restage']],
    ['CUSTOMER_UNAVAILABLE', null, 'ADMIN', ['restage']],
    ['FAILED', null, 'PACKING_STAFF', []],
    ['DELIVERED', null, 'ADMIN', []],
    ['CANCELLED', null, 'ADMIN', []],
  ] as const)('%s (rider %s) as %s', (status, rider, role, expected) => {
    const o = order({ order_status: status, active_delivery: rider ? withRider(rider) : null });
    expect(allowedActions(o, role)).toEqual(expected);
  });
});

describe('primaryAction', () => {
  it('is the one next step for the lane, when this role may take it', () => {
    expect(primaryAction(order(), 'PACKING_STAFF')).toBe('pack');
    expect(primaryAction(order({ items_summary: { total: 1, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 } }), 'ADMIN')).toBeNull();
    expect(primaryAction(order({ order_status: 'PACKED' }), 'ADMIN')).toBe('assign');
    expect(primaryAction(order({ order_status: 'PACKED' }), 'PACKING_STAFF')).toBeNull();
    expect(primaryAction(order({ order_status: 'PACKED', active_delivery: withRider('ASSIGNED') }), 'PACKING_STAFF')).toBe('handOver');
    expect(primaryAction(order({ order_status: 'FAILED' }), 'ADMIN')).toBe('restage');
    expect(primaryAction(order({ order_status: 'OUT_FOR_DELIVERY', active_delivery: withRider('PICKED_UP') }), 'ADMIN')).toBeNull();
  });
});

describe('formatAge', () => {
  const now = new Date('2026-09-19T10:00:00Z');
  it.each([
    ['2026-09-19T09:59:40Z', 'just now'],
    ['2026-09-19T09:37:00Z', '23 min'],
    ['2026-09-19T07:55:00Z', '2 h 5 min'],
    ['2026-09-18T09:00:00Z', '1 day'],
  ])('%s → %s', (placed, expected) => {
    expect(formatAge(placed, now)).toBe(expected);
  });
});
