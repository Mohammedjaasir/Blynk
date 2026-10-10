import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { formatScheduledSlot, formatSlotDay, formatSlotTime } from '../lib/format';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

// Scheduled delivery slots (owner, 2026-10-10).
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetTrackerSessionForTests();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// Sat 10 Oct 2026, 21:30 in Colombo (16:00Z).
const NOW = new Date('2026-10-10T16:00:00.000Z');
const at = (local: string) => new Date(`${local}+05:30`);

describe('formatScheduledSlot', () => {
  it('reads a tomorrow-morning slot as "Scheduled: Tomorrow 8–10 AM"', () => {
    expect(formatScheduledSlot('2026-10-11T02:30:00.000Z', '2026-10-11T04:30:00.000Z', NOW)).toBe(
      'Scheduled: Tomorrow 8–10 AM'
    );
  });

  it('uses Today, Tomorrow, then a short weekday date, all in Colombo time', () => {
    expect(formatSlotDay(at('2026-10-10T23:30:00'), NOW)).toBe('Today');
    expect(formatSlotDay(at('2026-10-11T00:00:00'), NOW)).toBe('Tomorrow');
    expect(formatSlotDay(at('2026-10-12T08:00:00'), NOW)).toBe('Mon 12 Oct');
    // 23:00Z on the 10th is already 04:30 on the 11th in Colombo.
    expect(formatSlotDay(new Date('2026-10-10T23:00:00.000Z'), NOW)).toBe('Tomorrow');
  });

  it('writes ranges with an en dash and one meridiem when both ends share it', () => {
    expect(formatSlotTime(at('2026-10-11T16:00:00'), at('2026-10-11T18:00:00'))).toBe('4–6 PM');
    expect(formatSlotTime(at('2026-10-11T11:00:00'), at('2026-10-11T13:00:00'))).toBe('11 AM–1 PM');
    expect(formatSlotTime(at('2026-10-11T08:30:00'), at('2026-10-11T09:30:00'))).toBe('8:30–9:30 AM');
    expect(formatSlotTime(at('2026-10-11T12:00:00'), at('2026-10-11T12:30:00'))).toBe('12–12:30 PM');
  });

  it('shows only the start when the slot end is unknown (older orders)', () => {
    expect(formatScheduledSlot(at('2026-10-10T08:00:00').toISOString(), null, at('2026-10-10T06:00:00'))).toBe(
      'Scheduled: Today 8 AM'
    );
  });

  it('is null for an ASAP order or an unreadable date', () => {
    expect(formatScheduledSlot(null, null, NOW)).toBeNull();
    expect(formatScheduledSlot(undefined, undefined, NOW)).toBeNull();
    expect(formatScheduledSlot('not a date', null, NOW)).toBeNull();
  });
});

/** Tomorrow (Colombo) at the given local time, relative to the real clock the screens use. */
function tomorrowAt(hhmm: string): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return new Date(`${next}T${hhmm}:00+05:30`).toISOString();
}

describe('Scheduled slot on screen', () => {
  it('shows the slot on the delivery screen', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () =>
        ok({ delivery: detail({ scheduled_for: tomorrowAt('08:00'), scheduled_until: tomorrowAt('10:00') }) }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.getByText('Scheduled: Tomorrow 8–10 AM')).toBeInTheDocument();
  });

  it('shows just the start when scheduled_until is null', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () =>
        ok({ delivery: detail({ scheduled_for: tomorrowAt('08:30'), scheduled_until: null }) }),
    });
    expect(await screen.findByText('Scheduled: Tomorrow 8:30 AM')).toBeInTheDocument();
  });

  it('shows nothing about a schedule for an ASAP order', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ scheduled_for: null, scheduled_until: null }) }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled:/)).not.toBeInTheDocument();
  });

  it('shows the slot on the active deliveries list, and nothing when absent', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [
            summary({ scheduled_for: tomorrowAt('16:00'), scheduled_until: tomorrowAt('18:00') }),
            summary({
              delivery_id: 'd-2',
              order_id: 'o-2',
              order_number: 'BLK-20260918-0002',
              assignment_status: 'ASSIGNED',
              order_status: 'PLACED',
            }),
          ],
        }),
    });
    expect(await screen.findByText('Scheduled: Tomorrow 4–6 PM')).toBeInTheDocument();
    expect(screen.getAllByText(/Scheduled:/)).toHaveLength(1);
  });
});
