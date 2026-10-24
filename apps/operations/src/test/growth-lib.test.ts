import { describe, expect, it } from 'vitest';
import { toRatingsSummary, toRepeatBasket, toRequestGroup } from '../api/growth';
import { audienceFromDraft, audienceLabel, audienceQuery, blankAudienceDraft } from '../lib/customerGroups';
import { clockText, colomboWhen, pushOpenPath, runText, scheduleText, starsText, tipsOf } from '../lib/growth';

/** Repeat baskets, ratings + tips, product requests, customer groups: the pure helpers (2026-10-24). */
describe('repeat basket words', () => {
  it('writes the schedule the way staff say it', () => {
    expect(clockText('08:00')).toBe('8:00 am');
    expect(clockText('12:15')).toBe('12:15 pm');
    expect(clockText('00:30')).toBe('12:30 am');
    expect(clockText('17:45')).toBe('5:45 pm');
    expect(scheduleText({ frequency: 'DAILY', weekday: null, place_at: '07:30' })).toBe('Every day at 7:30 am');
    expect(scheduleText({ frequency: 'WEEKLY', weekday: 1, place_at: '08:00' })).toBe('Every Monday at 8:00 am');
    expect(scheduleText({ frequency: 'BIWEEKLY', weekday: 0, place_at: '18:00' })).toBe('Every 2 weeks on Sunday at 6:00 pm');
  });

  it('shows the next run in Sri Lanka time', () => {
    // 02:30 UTC = 8:00 am Colombo, Monday 26 Oct 2026.
    expect(colomboWhen('2026-10-26T02:30:00.000Z')).toBe('Mon 26 Oct, 8:00 am');
    expect(colomboWhen(null)).toBe('');
  });

  it('describes the last run', () => {
    expect(runText({ status: 'PLACED', order_number: '1042', reason: null })).toBe('Placed - order #1042');
    expect(runText({ status: 'SKIPPED', order_number: null, reason: 'Store closed' })).toBe('Skipped - Store closed');
    expect(runText(null)).toBeNull();
  });

  it('reads a basket row, nested customer or flat', () => {
    const b = toRepeatBasket({
      id: 'rb1',
      name: 'Milk and bread',
      customer: { full_name: 'Ahmed Rizvi', phone: '+94771234567' },
      items: [{ product_id: 'p1' }, { product_id: 'p2' }],
      frequency: 'DAILY',
      place_at: '07:00',
      status: 'PAUSED',
      next_run_at: null,
      last_run: { run_at: '2026-10-23T01:30:00Z', status: 'PLACED', order_id: 'o9', reason: null },
    });
    expect(b).toMatchObject({ customer_name: 'Ahmed Rizvi', customer_phone: '+94771234567', items_count: 2, status: 'PAUSED' });
    expect(b.last_run?.order_id).toBe('o9');
    expect(toRepeatBasket({ id: 'x', customer_name: 'A', items_count: 4 }).items_count).toBe(4);
  });
});

describe('ratings and tips', () => {
  it('draws stars', () => {
    expect(starsText(4)).toBe('★★★★☆');
    expect(starsText(0)).toBe('☆☆☆☆☆');
  });

  it('reads the summary in either shape', () => {
    const a = toRatingsSummary(
      { average: 4.25, count: 8, per_star: { 1: 1, 2: 0, 3: 1, 4: 2, 5: 4 }, top_tags: [{ tag: 'FRESH', count: 3 }, { tag: 'LATE', count: 5 }], per_rider: [{ rider_id: 'r1', rider_name: 'Farhan', average: 4.5, count: 6 }] },
      30
    );
    expect(a.per_star).toEqual([0, 1, 0, 1, 2, 4]);
    expect(a.top_tags[0]).toEqual({ tag: 'LATE', count: 5 });
    expect(a.per_rider[0]).toMatchObject({ rider_name: 'Farhan', average: 4.5 });
    const b = toRatingsSummary({ average: '3.5', total: 2, by_star: [{ stars: 5, count: 1 }, { stars: 2, count: 1 }], tags: { ON_TIME: 2 } }, 30);
    expect(b).toMatchObject({ average: 3.5, count: 2, days: 30 });
    expect(b.per_star[5]).toBe(1);
    expect(b.top_tags).toEqual([{ tag: 'ON_TIME', count: 2 }]);
  });

  it('finds the tips figure only when the API sends one', () => {
    expect(tipsOf({ tips: 150 })).toBe(150);
    expect(tipsOf({ tips_lkr: '50.00' })).toBe(50);
    expect(tipsOf({ deliveries: 3 })).toBeUndefined();
    expect(tipsOf(null)).toBeUndefined();
  });

  it('opens the order for a rating push, the board for anything else', () => {
    expect(pushOpenPath({ type: 'staff_low_rating', order_id: 'o7' })).toBe('/orders/o7');
    expect(pushOpenPath({ type: 'staff_order', order_id: 'o7' })).toBe('/orders');
    expect(pushOpenPath(undefined)).toBe('/orders');
  });
});

describe('product request groups', () => {
  it('reads a group and its requests', () => {
    const g = toRequestGroup({
      key: 'oat milk',
      name: 'Oat milk',
      count: 3,
      status: 'PLANNED',
      requests: [{ id: 'q1', name: 'oat milk', note: 'Alpro', customer_name: 'Nimali', created_at: '2026-10-20T04:00:00Z' }],
    });
    expect(g).toMatchObject({ key: 'oat milk', count: 3, status: 'PLANNED' });
    expect(g.requests[0]).toMatchObject({ note: 'Alpro', customer_name: 'Nimali' });
    expect(toRequestGroup({ name: '  Oat   Milk ', status: 'WEIRD' })).toMatchObject({ key: 'oat milk', status: 'NEW', count: 0 });
  });
});

describe('customer groups', () => {
  it('builds the audience, or says what is wrong', () => {
    const draft = blankAudienceDraft();
    expect(audienceFromDraft(draft).audience).toEqual({ group: 'ALL' });
    expect(audienceFromDraft({ ...draft, group: 'LAPSED' }).audience).toEqual({ group: 'LAPSED', days: 14 });
    expect(audienceFromDraft({ ...draft, group: 'BIG_SPENDERS' }).audience).toEqual({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 });
    expect(audienceFromDraft({ ...draft, group: 'NEW', days: { ...draft.days, NEW: '61' } }).problem).toMatch(/1 to 60/);
    expect(audienceQuery({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 })).toBe('group=BIG_SPENDERS&days=90&min_spend_lkr=5000');
  });

  it('names an audience for the history, old words too', () => {
    expect(audienceLabel('ORDERED_30D')).toBe('Ordered in last 30 days');
    expect(audienceLabel({ group: 'LAPSED', days: 21 })).toBe("Haven't ordered in 21 days");
    expect(audienceLabel({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 })).toBe('Big spenders: LKR 5,000+ in 90 days');
    expect(audienceLabel(null)).toBe('All customers');
  });
});
