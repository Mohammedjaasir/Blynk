import { describe, expect, it } from 'vitest';
import type { AssignmentStatus, OrderStatus } from '../api/types';
import { canReportFailure, nextAction, splitQueue, stage } from '../lib/delivery';
import { summary } from './helpers';

/**
 * These helpers mirror the backend's rules so the rider is shown the one
 * action that can succeed. They are UX only: the API re-checks every step
 * under row locks, and the screens handle its 409s when the two disagree.
 */
describe('nextAction', () => {
  const cases: Array<[AssignmentStatus, OrderStatus, string]> = [
    ['ASSIGNED', 'PACKED', 'pickUp'],
    ['ACCEPTED', 'PACKED', 'pickUp'],
    ['ASSIGNED', 'PLACED', 'none:being-packed'],
    ['ASSIGNED', 'ITEM_UNAVAILABLE', 'none:being-packed'],
    ['ASSIGNED', 'CANCELLED', 'none:cancelled'],
    ['PICKED_UP', 'OUT_FOR_DELIVERY', 'arrive'],
    ['ARRIVED_AT_CUSTOMER', 'OUT_FOR_DELIVERY', 'collect'],
    ['ARRIVED_AT_CUSTOMER', 'CANCELLED', 'none:cancelled'],
    ['PICKED_UP', 'FAILED', 'none:failed'],
    ['FAILED', 'FAILED', 'none:failed'],
    ['PICKED_UP', 'CUSTOMER_UNAVAILABLE', 'none:failed'],
    ['DELIVERED', 'DELIVERED', 'none:done'],
    ['PICKED_UP', 'PACKED', 'none:check-store'],
  ];

  it.each(cases)('%s with order %s → %s', (assignment_status, order_status, expected) => {
    const action = nextAction(summary({ assignment_status, order_status }));
    expect(action.kind === 'none' ? `none:${action.reason}` : action.kind).toBe(expected);
  });

  it('collect carries the backend total and says it in the label', () => {
    const action = nextAction(
      summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY', total_amount: 1690 })
    );
    expect(action).toEqual({ kind: 'collect', label: 'Collect Rs. 1,690', amount: 1690 });
  });

  it('refuses to offer cash collection on an order that is not COD or already paid', () => {
    const base = { assignment_status: 'ARRIVED_AT_CUSTOMER' as const, order_status: 'OUT_FOR_DELIVERY' as const };
    expect(nextAction(summary({ ...base, payment_method: 'ONLINE' }))).toEqual({ kind: 'none', reason: 'not-cod' });
    expect(nextAction(summary({ ...base, payment_status: 'PAID' }))).toEqual({ kind: 'none', reason: 'not-cod' });
  });
});

describe('stage and failure reporting', () => {
  it('maps the delivery onto pick up → on the way → handover → done', () => {
    expect(stage(summary({ assignment_status: 'ASSIGNED' }))).toBe(0);
    expect(stage(summary({ assignment_status: 'PICKED_UP' }))).toBe(1);
    expect(stage(summary({ assignment_status: 'ARRIVED_AT_CUSTOMER' }))).toBe(2);
    expect(stage(summary({ assignment_status: 'DELIVERED' }))).toBe(3);
  });

  it("offers Can't deliver only once the order is on the road", () => {
    expect(canReportFailure(summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' }))).toBe(false);
    expect(canReportFailure(summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' }))).toBe(true);
    expect(
      canReportFailure(summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }))
    ).toBe(true);
    expect(canReportFailure(summary({ assignment_status: 'PICKED_UP', order_status: 'CANCELLED' }))).toBe(false);
  });
});

describe('splitQueue', () => {
  const assigned = summary({ delivery_id: 'a', assignment_status: 'ASSIGNED', order_status: 'PACKED' });
  const packing = summary({ delivery_id: 'p', assignment_status: 'ASSIGNED', order_status: 'PLACED' });
  const onRoad = summary({ delivery_id: 'r', assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
  const atDoor = summary({ delivery_id: 'd', assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' });
  const done = summary({ delivery_id: 'x', assignment_status: 'DELIVERED', order_status: 'DELIVERED', total_amount: 805 });
  const cancelled = summary({ delivery_id: 'c', assignment_status: 'ASSIGNED', order_status: 'CANCELLED' });

  it('puts the delivery at the door first, then one on the road, then one ready to pick up', () => {
    expect(splitQueue([assigned, onRoad, atDoor]).now?.delivery_id).toBe('d');
    expect(splitQueue([assigned, onRoad]).now?.delivery_id).toBe('r');
    expect(splitQueue([packing, assigned]).now?.delivery_id).toBe('a');
  });

  it('keeps the rest in the order the API gave (oldest assignment first) and separates delivered', () => {
    const q = splitQueue([packing, cancelled, assigned, done, onRoad]);
    expect(q.now?.delivery_id).toBe('r');
    expect(q.next.map((d) => d.delivery_id)).toEqual(['p', 'c', 'a']);
    expect(q.done.map((d) => d.delivery_id)).toEqual(['x']);
    expect(q.collectedToday).toBe(805);
  });

  it('has nothing to act on when every assignment is waiting or closed', () => {
    const q = splitQueue([packing, cancelled]);
    expect(q.now).toBeNull();
    expect(q.next).toHaveLength(2);
  });

  it('is empty for an empty list', () => {
    expect(splitQueue([])).toEqual({ now: null, next: [], done: [], collectedToday: 0 });
  });
});
