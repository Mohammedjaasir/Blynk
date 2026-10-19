import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { NEW_ORDER_POLL_MS } from '../lib/newOrders';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/** New-order alert in the Ops shell (owner, 2026-10-19: "Ops app should send notifications when order received"). */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('New order alert', () => {
  it('rings for an order placed after the app opened, not for the ones already there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let queue = [{ id: 'o1', order_number: 'BL-1', order_status: 'PLACED', placed_at: '2026-10-19T04:00:00Z' }];
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/orders': () => ok({ orders: queue, pagination: { page: 1, limit: 100, total: queue.length, total_pages: 1 } }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByTestId('new-order-banner')).toBeNull();

    queue = [...queue, { id: 'o2', order_number: 'BL-2', order_status: 'PLACED', placed_at: '2026-10-19T04:05:00Z' }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NEW_ORDER_POLL_MS + 100);
    });
    expect(await screen.findByTestId('new-order-banner')).toHaveTextContent('Order BL-2 is waiting to be packed.');
  });
});
