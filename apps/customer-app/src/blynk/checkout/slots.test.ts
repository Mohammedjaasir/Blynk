import { expect, test } from 'vitest';
import { asapOffered, availableSlot, canOrderNow, parseSlots, slotForOrder, slotsByDay } from './slots';

const raw = {
  enabled: true, asap_available: false, is_open_now: false, closed_kind: 'OUTSIDE_HOURS', closed_reason: null,
  reopens_at: null, next_open_at: '2026-10-14T02:30:00.000Z',
  slots: [
    { start: '2026-10-14T02:30:00.000Z', end: '2026-10-14T04:30:00.000Z', day_label: 'Tomorrow', time_label: '8-10 AM', label: 'Tomorrow 8-10 AM', remaining: 3, available: true },
    { start: '2026-10-14T04:30:00.000Z', end: '2026-10-14T06:30:00.000Z', day_label: 'Tomorrow', time_label: '10 AM-12 PM', label: 'Tomorrow 10 AM-12 PM', remaining: 0, available: false },
    { start: '2026-10-15T02:30:00.000Z', end: '2026-10-15T04:30:00.000Z', day_label: 'Thu 15 Oct', time_label: '8-10 AM', label: '', remaining: 5, available: true },
    { start: 'not a date', end: 'x', day_label: 'x', time_label: 'x' },
  ],
};

test('parses slots defensively: bad rows dropped, missing label built, full slots not pickable', () => {
  const s = parseSlots(raw)!;
  expect(s.slots).toHaveLength(3);
  expect(s.slots[2].label).toBe('Thu 15 Oct 8-10 AM');
  expect(s.slots[1].available).toBe(false);
  expect(parseSlots({})).toBeNull();
  expect(parseSlots({ enabled: false, slots: raw.slots })!.slots).toEqual([]);
  // older answer without asap_available: open = ASAP
  expect(parseSlots({ enabled: true, is_open_now: true, slots: [] })!.asap_available).toBe(true);
});

test('groups by day in the server order', () => {
  const g = slotsByDay(parseSlots(raw)!.slots);
  expect(g.map((x) => x.day)).toEqual(['Tomorrow', 'Thu 15 Oct']);
  expect(g[0].slots).toHaveLength(2);
});

test('closed store: ASAP is not offered, a picked slot with room lets the order go', () => {
  const s = parseSlots(raw)!;
  expect(asapOffered(s, false)).toBe(false);
  expect(canOrderNow({ storeOpen: false, slots: s, picked: null })).toBe(false);
  expect(canOrderNow({ storeOpen: false, slots: s, picked: '2026-10-14T02:30:00.000Z' })).toBe(true);
  // a full slot can't be booked
  expect(canOrderNow({ storeOpen: false, slots: s, picked: '2026-10-14T04:30:00.000Z' })).toBe(false);
  expect(slotForOrder(s, '2026-10-14T04:30:00.000Z')).toBeUndefined();
  expect(slotForOrder(s, '2026-10-14T02:30:00.000Z')).toBe('2026-10-14T02:30:00.000Z');
});

test('closed store with slots off: no ordering; open store: ASAP', () => {
  expect(canOrderNow({ storeOpen: false, slots: null, picked: null })).toBe(false);
  expect(canOrderNow({ storeOpen: true, slots: null, picked: null })).toBe(true);
  const off = parseSlots({ enabled: false, asap_available: true, slots: [] })!;
  expect(canOrderNow({ storeOpen: true, slots: off, picked: '2026-10-14T02:30:00.000Z' })).toBe(true);
  expect(availableSlot(off, '2026-10-14T02:30:00.000Z')).toBeNull();
});
