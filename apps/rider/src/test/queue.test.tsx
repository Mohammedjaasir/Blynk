import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests, getTracker, syncTracking } from '../lib/tracker-session';
import { capacitorTrackingPlugin } from '../lib/tracking-plugin';
import { NETWORK_DOWN, RIDER, fail, ok, renderAs, summary } from './helpers';

// The real plugin needs a native bridge that jsdom lacks; fake it as granted so the Queue's
// tracking sync can be observed. Same approach as delivery.test.tsx.
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const list = (...deliveries: unknown[]) => () => ok({ deliveries });

describe('Deliveries (home)', () => {
  it('shows a real empty state with a way to check again, and nothing invented', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(RIDER, '/');
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    expect(screen.queryByText(/Now/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(api.find('GET', '/riders/deliveries').length).toBeGreaterThanOrEqual(2);
  });

  it('puts the delivery to act on first: destination, order number, cash to collect, and a way in', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': list(
        summary({
          delivery_id: 'd-1',
          order_number: 'BLK-20260918-0042',
          delivery_address_line1: '14 Mosque Road',
          delivery_address_line2: 'Near the clock tower',
          total_amount: 1690,
        })
      ),
    });
    const now = await screen.findByRole('region', { name: 'Now' });
    expect(within(now).getByText('14 Mosque Road')).toBeInTheDocument();
    expect(within(now).getByText('Near the clock tower')).toBeInTheDocument();
    expect(within(now).getByText('#0042')).toBeInTheDocument();
    expect(within(now).getByText('LKR 1,690')).toBeInTheDocument();
    expect(within(now).getByText('Ready to pick up')).toBeInTheDocument();
    expect(within(now).getByRole('link', { name: 'Open delivery #0042' })).toHaveAttribute('href', '/deliveries/d-1');
  });

  it('lists the rest compactly and flags cancelled and still-packing orders', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': list(
        summary({ delivery_id: 'a', order_number: 'BLK-1-0001', assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' }),
        summary({ delivery_id: 'b', order_number: 'BLK-1-0002', order_status: 'PLACED', total_amount: 805 }),
        summary({ delivery_id: 'c', order_number: 'BLK-1-0003', order_status: 'CANCELLED' })
      ),
    });
    const next = await screen.findByRole('region', { name: 'Next' });
    const rows = within(next).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('#0002');
    expect(rows[0]).toHaveTextContent('Being packed');
    expect(rows[0]).toHaveTextContent('LKR 805');
    expect(rows[1]).toHaveTextContent("Cancelled — don't pick up");
    expect(within(screen.getByRole('region', { name: 'Now' })).getByText('#0001')).toBeInTheDocument();
  });

  it("summarises today's delivered orders and the cash collected", async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': list(
        summary({ delivery_id: 'x', assignment_status: 'DELIVERED', order_status: 'DELIVERED', payment_status: 'PAID', total_amount: 610 }),
        summary({ delivery_id: 'y', assignment_status: 'DELIVERED', order_status: 'DELIVERED', payment_status: 'PAID', total_amount: 805 })
      ),
    });
    const done = await screen.findByRole('region', { name: 'Done today' });
    expect(done).toHaveTextContent('2 delivered');
    expect(done).toHaveTextContent('LKR 1,415 collected');
    expect(screen.getByText('No deliveries assigned to you right now.')).toBeInTheDocument();
  });

  it('keeps the last list on screen when the network drops, says when it is from, and retries', async () => {
    const user = userEvent.setup();
    let down = false;
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => (down ? NETWORK_DOWN : ok({ deliveries: [summary()] })),
    });
    await screen.findByRole('region', { name: 'Now' });
    down = true;
    await user.click(screen.getByRole('button', { name: 'Refresh deliveries' }));
    expect(
      await screen.findByText("You're offline. Nothing was sent. Try again when you have signal.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Last updated \d\d:\d\d/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Now' })).toBeInTheDocument();
    down = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Now' })).toBeInTheDocument();
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  it('checks for new assignments every 30 seconds while visible, and when the app comes back to the front', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = renderAs(RIDER, '/');
    await screen.findByText('No deliveries assigned to you right now.');
    const count = () => api.find('GET', '/riders/deliveries').length;
    const before = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(count()).toBe(before + 1);

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(count()).toBe(before + 1);

    hidden.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(count()).toBe(before + 2);
  });

  it('greets the rider by first name and signs out', async () => {
    const user = userEvent.setup();
    renderAs(RIDER, '/');
    expect(await screen.findByText('Farhan')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('Deliveries (home) and location tracking', () => {
  const onRoad = summary({ delivery_id: 'd-road', assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
  const waiting = summary({ delivery_id: 'd-wait', assignment_status: 'ASSIGNED', order_status: 'PACKED' });

  it('resumes tracking on a cold start that lands here, with no Delivery screen open', async () => {
    renderAs(RIDER, '/', { 'GET /riders/deliveries': list(waiting, onRoad) });
    await screen.findByRole('region', { name: 'Now' });
    await waitFor(() => expect(capacitorTrackingPlugin.start).toHaveBeenCalledTimes(1));
    expect(getTracker().getDeliveryId()).toBe('d-road');
  });

  it('stops an active tracker when the list loads with nothing on the road', async () => {
    await syncTracking(onRoad);
    expect(getTracker().getDeliveryId()).toBe('d-road');
    renderAs(RIDER, '/', { 'GET /riders/deliveries': list(waiting) });
    await screen.findByRole('region', { name: 'Now' });
    await waitFor(() => expect(capacitorTrackingPlugin.stop).toHaveBeenCalledTimes(1));
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('a list that fails to load neither starts nor stops anything', async () => {
    await syncTracking(onRoad);
    vi.mocked(capacitorTrackingPlugin.start).mockClear();
    renderAs(RIDER, '/', { 'GET /riders/deliveries': () => fail(500, 'INTERNAL') });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(capacitorTrackingPlugin.start).not.toHaveBeenCalled();
    expect(capacitorTrackingPlugin.stop).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBe('d-road');
  });
});
