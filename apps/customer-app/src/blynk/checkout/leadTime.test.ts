import { describe, expect, test } from 'vitest';
import type { Combo, Product } from '../api/types';
import { setQuantity, type CartState } from '../cart/cartStore';
import { milk, sugar } from '../test/fixtures';
import { canOrderWithLead, cartLead, cartProductIds, LEAD_COPY, leadState, slotsFromLead } from './leadTime';
import { parseSlots, type DeliverySlots } from './slots';

const NOW = new Date('2026-10-14T04:00:00.000Z'); // Wed 14 Oct 09:30 Colombo
const cake: Product = { ...milk, id: 'p-cake', name: 'Ribbon Cake 1kg', delivery_lead_days: 2, earliest_delivery_date: '2026-10-16' };
const slot = (start: string, available = true) => ({ start, end: start, day_label: 'd', time_label: 't', label: 'd t', remaining: available ? 3 : 0, available });
const slotsOn = (extra: Partial<DeliverySlots> = {}): DeliverySlots => parseSlots({
  enabled: true, asap_available: false, is_open_now: true, lead_days: 2, earliest_delivery_date: '2026-10-16', earliest_delivery_label: 'Fri 16 Oct',
  slots: [slot('2026-10-15T02:30:00.000Z'), slot('2026-10-16T02:30:00.000Z'), slot('2026-10-16T04:30:00.000Z', false)],
  ...extra,
})!;
const cartWith = (...ps: Product[]): CartState => ps.reduce((s, p) => setQuantity(s, p, 1), { lines: [] } as CartState);

describe('the cart lead time', () => {
  test('the longest lead time in the cart, with the item that needs it', () => {
    const s = cartWith(milk, cake, { ...sugar, delivery_lead_days: 1 });
    expect(cartLead(s.lines)).toEqual({ days: 2, name: 'Ribbon Cake 1kg' });
    expect(cartLead(cartWith(milk).lines)).toEqual({ days: 0, name: null });
  });

  test('sold-out lines do not count; combo packs carry their own lead time', () => {
    const s = cartWith({ ...cake, is_available: false });
    expect(cartLead(s.lines).days).toBe(0);
    const combo = { id: 'c1', name: 'Party pack', is_available: true, delivery_lead_days: 3, items: [{ product_id: 'p-x' }] } as unknown as Combo;
    expect(cartLead(s.lines, [{ combo, quantity: 1 }])).toEqual({ days: 3, name: 'Party pack' });
    expect(cartProductIds(cartWith(milk, cake).lines, [{ combo, quantity: 1 }])).toEqual(['p-cake', 'p-milk', 'p-x']);
  });
});

describe('slot rules with a lead time', () => {
  test('no lead time: the usual rule (ASAP while open)', () => {
    const lead = leadState({ cart: { days: 0, name: null }, slots: null, quote: null, now: NOW });
    expect(lead.asapAllowed).toBe(true);
    expect(canOrderWithLead({ storeOpen: true, slots: null, picked: null, lead })).toBe(true);
    expect(canOrderWithLead({ storeOpen: false, slots: null, picked: null, lead })).toBe(false);
  });

  test('a lead time hides ASAP and needs a slot on/after the first delivery day', () => {
    const slots = slotsOn();
    const lead = leadState({ cart: cartLead(cartWith(cake).lines), slots, quote: null, now: NOW });
    expect(lead).toMatchObject({ days: 2, asapAllowed: false, blocked: false, date: '2026-10-16', dateLabel: 'Fri 16 Oct', name: 'Ribbon Cake 1kg' });
    expect(canOrderWithLead({ storeOpen: true, slots, picked: null, lead })).toBe(false);
    expect(canOrderWithLead({ storeOpen: true, slots, picked: '2026-10-16T02:30:00.000Z', lead })).toBe(true);
    // a full slot does not count
    expect(canOrderWithLead({ storeOpen: true, slots, picked: '2026-10-16T04:30:00.000Z', lead })).toBe(false);
    // a slot before the first day (an older server listing it) is filtered out
    const shown = slotsFromLead(slots, lead)!;
    expect(shown.slots.map((s) => s.start)).toEqual(['2026-10-16T02:30:00.000Z', '2026-10-16T04:30:00.000Z']);
    expect(shown.asap_available).toBe(false);
  });

  test('slots switched off with a lead time: blocked, explained, never orderable', () => {
    const slots = parseSlots({ enabled: false, asap_available: true, slots: [] })!;
    const lead = leadState({ cart: { days: 2, name: 'Ribbon Cake 1kg' }, slots, quote: null, now: NOW });
    expect(lead.blocked).toBe(true);
    expect(canOrderWithLead({ storeOpen: true, slots, picked: null, lead })).toBe(false);
    expect(LEAD_COPY.slotsOff).toMatch(/Remove the item to order now/);
  });

  test('the server lead time wins over an older catalogue copy (checkout-info or slots)', () => {
    const quote = { delivery_lead: { lead_days: 3, earliest_delivery_date: '2026-10-17', earliest_delivery_label: 'Sat 17 Oct', asap_allowed: false } };
    const lead = leadState({ cart: { days: 0, name: null }, slots: null, quote, now: NOW });
    expect(lead).toMatchObject({ days: 3, date: '2026-10-17', dateLabel: 'Sat 17 Oct', asapAllowed: false, name: null });
    const fromSlots = leadState({ cart: { days: 1, name: 'x' }, slots: slotsOn(), quote: null, now: NOW });
    expect(fromSlots).toMatchObject({ days: 2, date: '2026-10-16' });
    // no date from anyone: today + N in Colombo
    expect(leadState({ cart: { days: 2, name: 'x' }, slots: null, quote: null, now: NOW }).date).toBe('2026-10-16');
  });

  test('the copy names the item and the day', () => {
    expect(LEAD_COPY.needs('Ribbon Cake 1kg', 2, 'Fri 16 Oct')).toBe('Ribbon Cake 1kg needs 2 days. The earliest delivery is Fri 16 Oct.');
    expect(LEAD_COPY.needs(null, 1, null)).toBe('An item in your cart needs 1 day.');
  });
});

test('slots parse the lead fields (absent on an older server = 0)', () => {
  expect(slotsOn().lead_days).toBe(2);
  expect(slotsOn().earliest_delivery_label).toBe('Fri 16 Oct');
  expect(parseSlots({ enabled: true, slots: [] })!.lead_days).toBe(0);
});
