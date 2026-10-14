import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DeliveryDetail } from '../api/types';
import { isPaidOnline, nextAction, splitQueue } from '../lib/delivery';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

/**
 * PayHere online payments (owner, 2026-10-14): an order paid online is handed
 * over with the customer's delivery code only - the rider is told not to
 * collect cash, and no cash amount is shown or counted.
 */
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
});

const atDoor = { assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' } as const;
const paid = { payment_method: 'ONLINE', payment_status: 'PAID' } as const;

describe('paid online: rules', () => {
  it('only ONLINE + PAID counts as paid online', () => {
    expect(isPaidOnline(summary(paid))).toBe(true);
    expect(isPaidOnline(summary({ payment_method: 'ONLINE', payment_status: 'PENDING' }))).toBe(false);
    expect(isPaidOnline(summary({ payment_method: 'COD', payment_status: 'PAID' }))).toBe(false);
  });

  it('at the door the step is confirming the code, with no cash amount', () => {
    expect(nextAction(summary({ ...atDoor, ...paid, total_amount: 1690 }))).toEqual({
      kind: 'collect',
      label: 'Confirm delivery code',
      amount: 0,
      prepaid: true,
    });
    // An online order that is not paid still goes back to the store.
    expect(nextAction(summary({ ...atDoor, payment_method: 'ONLINE', payment_status: 'PENDING' }))).toEqual({
      kind: 'none',
      reason: 'not-cod',
    });
  });

  it('cash collected today leaves out orders paid online', () => {
    const done = { assignment_status: 'DELIVERED', order_status: 'DELIVERED' } as const;
    const q = splitQueue([
      summary({ ...done, delivery_id: 'a', payment_status: 'PAID', total_amount: 500 }),
      summary({ ...done, delivery_id: 'b', ...paid, total_amount: 900 }),
    ]);
    expect(q.collectedToday).toBe(500);
  });
});

describe('paid online: screens', () => {
  it('the delivery says "Paid online — do not collect cash" and the code alone completes it', async () => {
    const user = userEvent.setup();
    const state: { current: DeliveryDetail } = { current: detail({ ...atDoor, ...paid, total_amount: 1690 }) };
    const { api } = renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: state.current }),
      'POST /riders/deliveries/:id/collect-cod': () => {
        state.current = detail({
          ...paid,
          assignment_status: 'DELIVERED',
          order_status: 'DELIVERED',
          total_amount: 1690,
          cod_collected_amount: 0,
          delivered_at: '2026-10-14T09:30:00.000Z',
        });
        return ok({ settlement: { order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: 0 } });
      },
    });
    expect(await screen.findByText('Paid online — do not collect cash')).toBeInTheDocument();
    expect(screen.queryByText('Cash to collect')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Collect LKR/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm delivery code' }));
    const sheet = screen.getByRole('dialog', { name: 'Confirm the delivery code' });
    expect(sheet).toHaveTextContent('do not collect cash');
    expect(sheet).not.toHaveTextContent('Count it');
    await user.type(within(sheet).getByLabelText("Customer's delivery code"), '4821');
    await user.click(within(sheet).getByRole('button', { name: 'Code checked — complete' }));
    expect(await screen.findByText('Paid online — no cash collected')).toBeInTheDocument();
    expect(api.find('POST', '/riders/deliveries/d-1/collect-cod')[0].body).toMatchObject({ delivery_code: '4821' });
  });

  it('the home card shows the paid-online note instead of cash to collect', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({ deliveries: [summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY', ...paid })] }),
    });
    expect(await screen.findByText('Paid online — do not collect cash')).toBeInTheDocument();
    expect(screen.queryByText('Cash to collect')).not.toBeInTheDocument();
  });
});
