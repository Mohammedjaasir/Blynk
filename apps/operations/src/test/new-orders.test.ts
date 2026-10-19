import { describe, expect, it } from 'vitest';
import { newOrdersSince, newOrderText } from '../lib/newOrders';

/** New-order alerts (owner, 2026-10-19: "Ops app should send notifications when order received"). */
const o = (id: string, status = 'PLACED') => ({ id, order_number: `BL-${id}`, order_status: status });

describe('newOrdersSince', () => {
  it('the first look rings for nothing; a later new PLACED order rings once', () => {
    const first = newOrdersSince(null, [o('1'), o('2')]);
    expect(first.fresh).toEqual([]);
    const second = newOrdersSince(first.seen, [o('1'), o('2'), o('3')]);
    expect(second.fresh.map((x) => x.id)).toEqual(['3']);
    const third = newOrdersSince(second.seen, [o('1'), o('2'), o('3')]);
    expect(third.fresh).toEqual([]);
  });

  it('an order that leaves the queue and comes back does not ring again; ITEM_UNAVAILABLE never rings', () => {
    const a = newOrdersSince(null, [o('1')]);
    const b = newOrdersSince(a.seen, []);
    expect(newOrdersSince(b.seen, [o('1')]).fresh).toEqual([]);
    expect(newOrdersSince(b.seen, [o('9', 'ITEM_UNAVAILABLE')]).fresh).toEqual([]);
  });

  it('words for one and for several', () => {
    expect(newOrderText([o('7')])).toEqual({ title: 'New order received', body: 'Order BL-7 is waiting to be packed.' });
    expect(newOrderText([o('7'), o('8')]).title).toBe('2 new orders');
  });
});
