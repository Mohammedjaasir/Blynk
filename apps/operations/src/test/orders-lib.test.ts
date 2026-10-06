import { describe, it, expect } from 'vitest';
import {
  allowedActions,
  boardOrderLikeFromDetail,
  formatAge,
  isPackable,
  laneOf,
  primaryAction,
  type BoardOrderLike,
} from '../lib/orders';
import type { OrderDetail } from '../api/types';

/**
 * The Orders board/detail's display rules (task F3). Mirrors
 * apps/admin/src/test/orders-lib.test.ts's own coverage shape, minus the
 * role dimension Operations' own `lib/orders.ts` doesn't have (the operator
 * is always ADMIN - see that file's doc comment).
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
  ] as const)('%#', (o, lane) => {
    expect(laneOf(o)).toBe(lane);
  });
});

describe('isPackable (D7)', () => {
  it('packs straight from Placed: pending items are fine; no unsourced substitution, and something in the bag', () => {
    expect(isPackable(order())).toBe(true);
    expect(
      isPackable(order({ items_summary: { total: 2, pending: 1, sourced: 1, packed: 0, unavailable: 0, substituted: 0 } }))
    ).toBe(true);
    expect(
      isPackable(order({ items_summary: { total: 2, pending: 2, sourced: 0, packed: 0, unavailable: 0, substituted: 0 } }))
    ).toBe(true);
    expect(
      isPackable(order({ items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 1, substituted: 0 } }))
    ).toBe(true);
    expect(
      isPackable(order({ items_summary: { total: 1, pending: 0, sourced: 0, packed: 0, unavailable: 0, substituted: 1 } }))
    ).toBe(false);
    expect(
      isPackable(order({ items_summary: { total: 1, pending: 0, sourced: 0, packed: 0, unavailable: 1, substituted: 0 } }))
    ).toBe(false);
    expect(
      isPackable(order({ items_summary: { total: 2, pending: 0, sourced: 1, packed: 0, unavailable: 1, substituted: 0 } }))
    ).toBe(true);
  });
});

describe('allowedActions (always ADMIN - no role dimension)', () => {
  it.each([
    ['PLACED', null, ['pack', 'cancel']],
    ['ITEM_UNAVAILABLE', null, ['pack', 'cancel']],
    ['PACKED', null, ['assign', 'cancel']],
    ['PACKED', 'ASSIGNED', ['handOver', 'cancel']],
    ['PACKED', 'ACCEPTED', ['handOver', 'cancel']],
    ['PACKED', 'PICKED_UP', ['cancel']],
    ['OUT_FOR_DELIVERY', 'PICKED_UP', ['markDelivered', 'markFailed', 'markCustomerUnavailable']],
    ['FAILED', null, ['restage']],
    ['CUSTOMER_UNAVAILABLE', null, ['restage']],
    ['DELIVERED', null, []],
    ['CANCELLED', null, []],
  ] as const)('%s (rider %s)', (status, rider, expected) => {
    const o = order({ order_status: status, active_delivery: rider ? withRider(rider) : null });
    expect(allowedActions(o)).toEqual(expected);
  });
});

describe('primaryAction', () => {
  it('is the one next step for the lane', () => {
    expect(primaryAction(order())).toBe('pack');
    // Nothing to source first: a just-placed order's next step is Pack.
    expect(
      primaryAction(order({ items_summary: { total: 1, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 } }))
    ).toBe('pack');
    expect(
      primaryAction(order({ items_summary: { total: 1, pending: 0, sourced: 0, packed: 0, unavailable: 1, substituted: 0 } }))
    ).toBeNull();
    expect(primaryAction(order({ order_status: 'PACKED' }))).toBe('assign');
    expect(primaryAction(order({ order_status: 'PACKED', active_delivery: withRider('ASSIGNED') }))).toBe('handOver');
    expect(primaryAction(order({ order_status: 'FAILED' }))).toBe('restage');
    expect(primaryAction(order({ order_status: 'OUT_FOR_DELIVERY', active_delivery: withRider('PICKED_UP') }))).toBeNull();
  });

  // The board (Orders.tsx) only acts on primaryAction, so it never needs a
  // bare "DELIVERED" status: marking delivered needs the customer's code and
  // lives on the order detail screen.
  it('is never "Mark delivered", in any status', () => {
    const statuses = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'DELIVERED', 'CANCELLED'];
    for (const order_status of statuses) {
      for (const active_delivery of [null, withRider('ASSIGNED'), withRider('PICKED_UP'), withRider('ARRIVED_AT_CUSTOMER')]) {
        expect(primaryAction(order({ order_status: order_status as BoardOrderLike['order_status'], active_delivery }))).not.toBe(
          'markDelivered'
        );
      }
    }
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

describe('boardOrderLikeFromDetail', () => {
  const baseDetail = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
    id: 'o1',
    order_number: 'BL-20260919-0042',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: 500,
    placed_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [],
    history: [],
    delivery: null,
    ...overrides,
  });

  it('counts items_summary from the real items[] array (the same aggregate the backend computes for the board query)', () => {
    const detail = baseDetail({
      items: [
        { id: 'i1', product_name_snapshot: 'Milk', quantity: 1, item_status: 'PENDING' },
        { id: 'i2', product_name_snapshot: 'Bread', quantity: 2, item_status: 'SOURCED' },
        { id: 'i3', product_name_snapshot: 'Butter', quantity: 1, item_status: 'PACKED' },
        { id: 'i4', product_name_snapshot: 'Eggs', quantity: 1, item_status: 'UNAVAILABLE' },
        { id: 'i5', product_name_snapshot: 'Cheese', quantity: 1, item_status: 'SUBSTITUTED' },
      ],
    });
    expect(boardOrderLikeFromDetail(detail).items_summary).toEqual({
      total: 5,
      pending: 1,
      sourced: 1,
      packed: 1,
      unavailable: 1,
      substituted: 1,
    });
  });

  it('treats a delivery in an active status as the active delivery', () => {
    const detail = baseDetail({
      order_status: 'OUT_FOR_DELIVERY',
      delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'PICKED_UP', rider_name: 'Farhan Mohamed' },
    });
    expect(boardOrderLikeFromDetail(detail).active_delivery).toEqual({
      id: 'd1',
      rider_id: 'r1',
      assignment_status: 'PICKED_UP',
      rider_name: 'Farhan Mohamed',
    });
  });

  it('a delivery that has already finished (DELIVERED/FAILED/REJECTED) is not treated as active', () => {
    const detail = baseDetail({
      order_status: 'FAILED',
      delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'FAILED', rider_name: 'Farhan Mohamed' },
    });
    expect(boardOrderLikeFromDetail(detail).active_delivery).toBeNull();
  });

  it('no delivery at all is null, not a fabricated one', () => {
    expect(boardOrderLikeFromDetail(baseDetail()).active_delivery).toBeNull();
  });
});
