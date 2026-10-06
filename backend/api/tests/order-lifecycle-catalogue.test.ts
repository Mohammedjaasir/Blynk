import { describe, it, expect } from 'vitest';
import {
  CATALOGUE,
  ACTION_NAMES,
  adminStatusAction,
  packingBlockers,
  isUncostedSubstitution,
  ITEM_WORK_STATES,
  type ActionName,
} from '../src/modules/orders/lifecycle/catalogue.js';
import { ACTIONS } from '../src/modules/orders/lifecycle/actions/index.js';
import type { LockedState, TransitionRequest } from '../src/modules/orders/lifecycle/types.js';
import type { OrderStatus, UserRole } from '../src/database/types.js';

/**
 * The canonical order lifecycle, checked without a database: the catalogue is
 * complete, every action refuses every order state outside its `from` with the
 * documented code (plan §O.2), the admin status endpoint maps to the right
 * action, and the packing rule (D7) holds. Expected values are written out
 * here independently of the implementation.
 */
const ALL_STATES: OrderStatus[] = [
  'PLACED',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'CUSTOMER_UNAVAILABLE',
  'ITEM_UNAVAILABLE',
];
const CLOSED: OrderStatus[] = ['CANCELLED', 'DELIVERED', 'FAILED', 'CUSTOMER_UNAVAILABLE'];

const EXPECTED: Record<ActionName, { from: OrderStatus[]; to: OrderStatus | null; roles: UserRole[] }> = {
  CUSTOMER_CANCEL: { from: ['PLACED', 'PACKED'], to: 'CANCELLED', roles: ['CUSTOMER'] },
  RESOLVE_ITEM: { from: ['PLACED', 'ITEM_UNAVAILABLE'], to: 'ITEM_UNAVAILABLE', roles: ['ADMIN', 'PACKING_STAFF', 'OPERATIONS'] },
  PACK: { from: ['PLACED', 'ITEM_UNAVAILABLE'], to: 'PACKED', roles: ['ADMIN', 'PACKING_STAFF', 'OPERATIONS'] },
  ASSIGN_RIDER: { from: ['PACKED'], to: null, roles: ['ADMIN', 'OPERATIONS'] },
  HAND_TO_RIDER: { from: ['PACKED'], to: 'OUT_FOR_DELIVERY', roles: ['ADMIN', 'PACKING_STAFF', 'OPERATIONS'] },
  // The Operations app's operator is an ADMIN linked to a riders row and runs
  // the same four rider steps (operations plan §2, §7). The `riderDelivery`
  // lock still scopes every one of them to the caller's own rider profile.
  // OPERATIONS (migration 014) is the Operations app's own staff role and
  // makes every step the ADMIN operator made there.
  RIDER_PICKUP: { from: ['PACKED'], to: 'OUT_FOR_DELIVERY', roles: ['RIDER', 'ADMIN', 'OPERATIONS'] },
  RIDER_ARRIVE: { from: ['OUT_FOR_DELIVERY'], to: null, roles: ['RIDER', 'ADMIN', 'OPERATIONS'] },
  RIDER_FAIL: { from: ['OUT_FOR_DELIVERY'], to: 'FAILED', roles: ['RIDER', 'ADMIN', 'OPERATIONS'] },
  RIDER_COLLECT_COD: { from: ['OUT_FOR_DELIVERY'], to: 'DELIVERED', roles: ['RIDER', 'ADMIN', 'OPERATIONS'] },
  ADMIN_MARK_DELIVERED: { from: ['OUT_FOR_DELIVERY'], to: 'DELIVERED', roles: ['ADMIN', 'OPERATIONS'] },
  ADMIN_MARK_FAILED: { from: ['OUT_FOR_DELIVERY'], to: 'FAILED', roles: ['ADMIN', 'OPERATIONS'] },
  ADMIN_MARK_CUSTOMER_UNAVAILABLE: { from: ['OUT_FOR_DELIVERY'], to: 'CUSTOMER_UNAVAILABLE', roles: ['ADMIN', 'OPERATIONS'] },
  ADMIN_CANCEL: { from: ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'], to: 'CANCELLED', roles: ['ADMIN', 'OPERATIONS'] },
  RESTAGE: { from: ['FAILED', 'CUSTOMER_UNAVAILABLE'], to: 'PACKED', roles: ['ADMIN', 'OPERATIONS'] },
};

/** The documented error when the order is in `status`, which is not in the action's `from`. */
function expectedWrongState(action: ActionName, status: OrderStatus): [number, string] {
  switch (action) {
    case 'CUSTOMER_CANCEL':
      if (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED') return [400, 'ORDER_ALREADY_OUT_FOR_DELIVERY'];
      if (status === 'CANCELLED') return [400, 'ORDER_ALREADY_CANCELLED'];
      return [400, 'ORDER_CANNOT_BE_CANCELLED'];
    case 'RESOLVE_ITEM':
      return [400, 'ORDER_NOT_IN_SOURCING_STATE'];
    case 'ASSIGN_RIDER':
      return [422, 'ORDER_NOT_READY_FOR_ASSIGNMENT'];
    case 'RIDER_PICKUP':
      return CLOSED.includes(status) ? [409, 'ORDER_NOT_ACTIVE'] : [409, 'ORDER_NOT_READY_FOR_PICKUP'];
    case 'RIDER_ARRIVE':
    case 'RIDER_FAIL':
      return CLOSED.includes(status) ? [409, 'ORDER_NOT_ACTIVE'] : [409, 'INVALID_DELIVERY_TRANSITION'];
    case 'RIDER_COLLECT_COD':
      return CLOSED.includes(status) ? [409, 'ORDER_NOT_ACTIVE'] : [409, 'INVALID_DELIVERY_TRANSITION'];
    default:
      return [422, 'INVALID_STATUS_TRANSITION'];
  }
}

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const actorFor = (role: UserRole) => ({ id: 'a0000001-0000-0000-0000-000000000009', role });

/** A locked state in which the action would succeed, apart from the order status under test. */
function happyState(action: ActionName, status: OrderStatus): LockedState {
  const order: any = {
    id: ORDER_ID,
    order_status: status,
    customer_id: actorFor('CUSTOMER').id,
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: '610.00',
  };
  const delivery = (assignment_status: string): any => ({ id: 'd1', order_id: ORDER_ID, rider_id: 'r1', assignment_status });
  switch (action) {
    case 'RESOLVE_ITEM':
      return { order, item: { id: 'i1', order_id: ORDER_ID, item_status: 'PENDING' } as any };
    case 'PACK':
      return { order, items: [{ id: 'i1', item_status: 'SOURCED', actual_unit_cost: '450.00' } as any] };
    case 'ASSIGN_RIDER':
      return { order, activeDeliveries: [] };
    case 'HAND_TO_RIDER':
      return { order, activeDeliveries: [delivery('ASSIGNED')] };
    case 'RIDER_PICKUP':
      return { order, delivery: delivery('ASSIGNED') };
    case 'RIDER_ARRIVE':
    case 'RIDER_FAIL':
      return { order, delivery: delivery('PICKED_UP') };
    case 'RIDER_COLLECT_COD':
      return { order, delivery: delivery('ARRIVED_AT_CUSTOMER') };
    case 'ADMIN_MARK_DELIVERED':
    case 'ADMIN_MARK_FAILED':
    case 'ADMIN_MARK_CUSTOMER_UNAVAILABLE':
      return { order, activeDeliveries: [delivery('ARRIVED_AT_CUSTOMER')] };
    case 'RESTAGE':
      return { order, activeDeliveries: [] };
    default:
      return { order };
  }
}

function requestFor(action: ActionName): TransitionRequest {
  const role = EXPECTED[action].roles[0];
  return {
    actor: actorFor(role),
    orderId: ORDER_ID,
    input: { notes: 'Checked with the customer', amount: 610, failure_reason: 'Bike broke down', item_status: 'UNAVAILABLE', rider_id: 'r1' },
  };
}

function thrown(fn: () => void): [number, string] | null {
  try {
    fn();
    return null;
  } catch (err: any) {
    return [err.statusCode, err.code];
  }
}

describe('order lifecycle catalogue', () => {
  it('has exactly the 14 documented actions, each fully described', () => {
    expect([...ACTION_NAMES].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const name of ACTION_NAMES) {
      const entry = CATALOGUE[name];
      expect(entry.action).toBe(name);
      expect([...entry.from].sort()).toEqual([...EXPECTED[name].from].sort());
      expect(entry.to).toBe(EXPECTED[name].to);
      expect([...entry.roles].sort()).toEqual([...EXPECTED[name].roles].sort());
      expect(['order', 'item', 'allItems', 'riderDelivery', 'activeDeliveries']).toContain(entry.lock);
      expect(typeof entry.notesRequired).toBe('boolean');
      expect(Array.isArray(entry.notifications)).toBe(true);
      expect(ACTIONS[name]).toBeDefined();
    }
  });

  it('declares the documented lock scope and notes rule for each action', () => {
    const lock = Object.fromEntries(ACTION_NAMES.map((n) => [n, CATALOGUE[n].lock]));
    expect(lock).toEqual({
      CUSTOMER_CANCEL: 'order',
      RESOLVE_ITEM: 'item',
      PACK: 'allItems',
      ASSIGN_RIDER: 'order',
      HAND_TO_RIDER: 'activeDeliveries',
      RIDER_PICKUP: 'riderDelivery',
      RIDER_ARRIVE: 'riderDelivery',
      RIDER_FAIL: 'riderDelivery',
      RIDER_COLLECT_COD: 'riderDelivery',
      ADMIN_MARK_DELIVERED: 'activeDeliveries',
      ADMIN_MARK_FAILED: 'activeDeliveries',
      ADMIN_MARK_CUSTOMER_UNAVAILABLE: 'activeDeliveries',
      ADMIN_CANCEL: 'order',
      RESTAGE: 'activeDeliveries',
    });
    const notes = ACTION_NAMES.filter((n) => CATALOGUE[n].notesRequired).sort();
    expect(notes).toEqual(
      ['ADMIN_CANCEL', 'ADMIN_MARK_CUSTOMER_UNAVAILABLE', 'ADMIN_MARK_DELIVERED', 'ADMIN_MARK_FAILED', 'RESTAGE'].sort()
    );
    // Proof of delivery: only "Mark delivered" takes the customer's code instead of the (override) note.
    expect(ACTION_NAMES.filter((n) => CATALOGUE[n].codeReplacesNotes)).toEqual(['ADMIN_MARK_DELIVERED']);
  });

  describe.each(Object.keys(EXPECTED) as ActionName[])('%s', (action) => {
    it.each(ALL_STATES)('order in %s', (status) => {
      const result = thrown(() => ACTIONS[action].checkState(happyState(action, status), requestFor(action)));
      if (EXPECTED[action].from.includes(status)) {
        expect(result).toBeNull();
      } else {
        expect(result).toEqual(expectedWrongState(action, status));
      }
    });
  });

  it('keeps sourcing and item resolution to the packing stage (D9)', () => {
    expect([...ITEM_WORK_STATES].sort()).toEqual(['ITEM_UNAVAILABLE', 'PLACED']);
  });
});

describe('admin status endpoint → action', () => {
  const table: Array<[OrderStatus, OrderStatus, ActionName | null]> = [];
  for (const current of ALL_STATES) {
    table.push([current, 'PACKED', current === 'FAILED' || current === 'CUSTOMER_UNAVAILABLE' ? 'RESTAGE' : 'PACK']);
    table.push([current, 'OUT_FOR_DELIVERY', 'HAND_TO_RIDER']);
    table.push([current, 'DELIVERED', 'ADMIN_MARK_DELIVERED']);
    table.push([current, 'FAILED', 'ADMIN_MARK_FAILED']);
    table.push([current, 'CUSTOMER_UNAVAILABLE', 'ADMIN_MARK_CUSTOMER_UNAVAILABLE']);
    table.push([current, 'CANCELLED', 'ADMIN_CANCEL']);
    table.push([current, 'PLACED', null]);
    table.push([current, 'ITEM_UNAVAILABLE', null]);
  }
  it.each(table)('current %s, requested %s → %s', (current, target, action) => {
    expect(adminStatusAction(target, current)).toBe(action);
  });
});

describe('packing rule (D7, revised 2026-09-30: no separate sourcing)', () => {
  const it_ = (item_status: string, actual_unit_cost: string | null = null) => ({ item_status, actual_unit_cost }) as any;
  it('packs when something is in the bag - sourced, packed or still pending', () => {
    expect(packingBlockers([it_('SOURCED', '1'), it_('UNAVAILABLE')])).toBeNull();
    expect(packingBlockers([it_('PACKED', '1')])).toBeNull();
    expect(packingBlockers([it_('SUBSTITUTED', '5.00'), it_('SOURCED', '1')])).toBeNull();
    expect(packingBlockers([it_('SOURCED', '1'), it_('PENDING')])).toBeNull();
    expect(packingBlockers([it_('PENDING'), it_('PENDING'), it_('UNAVAILABLE')])).toBeNull();
  });
  it('blocks on a substitution with no recorded cost', () => {
    expect(packingBlockers([it_('SUBSTITUTED', null)])).toEqual({ unsourced_substitutions: 1, packable_items: 0 });
    expect(packingBlockers([it_('SUBSTITUTED', null), it_('PENDING')])).toEqual({ unsourced_substitutions: 1, packable_items: 1 });
  });
  it('blocks an empty bag', () => {
    expect(packingBlockers([it_('UNAVAILABLE'), it_('UNAVAILABLE')])).toEqual({ unsourced_substitutions: 0, packable_items: 0 });
  });
  it('an uncosted substitution is exactly what packing refuses (the board counts with the same rule)', () => {
    expect(isUncostedSubstitution(it_('SUBSTITUTED', null))).toBe(true);
    expect(isUncostedSubstitution({ item_status: 'SUBSTITUTED', actual_unit_cost: undefined } as any)).toBe(true);
    expect(isUncostedSubstitution(it_('SUBSTITUTED', '5.00'))).toBe(false);
    expect(isUncostedSubstitution(it_('SUBSTITUTED', 0 as any))).toBe(false);
    expect(isUncostedSubstitution(it_('PENDING', null))).toBe(false);
    expect(isUncostedSubstitution(it_('UNAVAILABLE', null))).toBe(false);
  });
});

describe('stock effect per action (inventory plan §4)', () => {
  const RESTORING: ActionName[] = ['ADMIN_CANCEL', 'CUSTOMER_CANCEL'];
  it('only the two cancellations return stock', () => {
    expect(ACTION_NAMES.filter((a) => CATALOGUE[a].stock === 'RESTORE_ORDER_STOCK').sort()).toEqual(RESTORING);
  });
  it('only packing takes stock (for the items not yet sourced)', () => {
    expect(ACTION_NAMES.filter((a) => CATALOGUE[a].stock === 'TAKE_PENDING_STOCK')).toEqual(['PACK']);
  });
  it.each(ACTION_NAMES.filter((a) => !RESTORING.includes(a) && a !== 'PACK'))('%s never moves stock', (a) => {
    expect(CATALOGUE[a].stock).toBe('NONE');
  });
});
