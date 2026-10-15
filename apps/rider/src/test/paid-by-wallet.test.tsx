import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DeliveryDetail } from '../api/types';
import { isPaidByWallet, nextAction, walletPaid } from '../lib/delivery';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

/**
 * Blynk Wallet (owner, 2026-10-15; docs/api/wallet.md): total_amount is
 * already less what the wallet paid. When the wallet paid it all the rider
 * collects nothing ("LKR 0 to collect - paid by wallet") and the code alone
 * completes the handover; when it paid part, the rider collects the rest.
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

describe('paid by wallet: rules', () => {
  it('only a zero total with a wallet payment counts as paid by wallet', () => {
    expect(isPaidByWallet(summary({ total_amount: 0, wallet_amount_used: 1150 }))).toBe(true);
    expect(isPaidByWallet(summary({ total_amount: 400, wallet_amount_used: 750 }))).toBe(false);
    // A points-only zero total is not the wallet.
    expect(isPaidByWallet(summary({ total_amount: 0, wallet_amount_used: 0 }))).toBe(false);
    expect(isPaidByWallet(summary({ total_amount: 0 }))).toBe(false);
    expect(walletPaid(summary({}))).toBe(0);
    expect(walletPaid(summary({ wallet_amount_used: 750 }))).toBe(750);
  });

  it('at the door the step is the code, with amount 0', () => {
    expect(nextAction(summary({ ...atDoor, total_amount: 0, wallet_amount_used: 1150 }))).toEqual({
      kind: 'collect',
      label: 'Confirm delivery code',
      amount: 0,
      prepaid: true,
    });
    // Part paid by the wallet: collect what is left, as before.
    expect(nextAction(summary({ ...atDoor, total_amount: 400, wallet_amount_used: 750 }))).toEqual({
      kind: 'collect',
      label: 'Collect LKR 400',
      amount: 400,
    });
  });
});

describe('paid by wallet: screens', () => {
  it('says "LKR 0 to collect - paid by wallet" and completes with amount 0 and the code', async () => {
    const user = userEvent.setup();
    const state: { current: DeliveryDetail } = { current: detail({ ...atDoor, total_amount: 0, wallet_amount_used: 1150 }) };
    const { api } = renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: state.current }),
      'POST /riders/deliveries/:id/collect-cod': () => {
        state.current = detail({
          assignment_status: 'DELIVERED',
          order_status: 'DELIVERED',
          payment_status: 'PAID',
          total_amount: 0,
          wallet_amount_used: 1150,
          cod_collected_amount: 0,
          delivered_at: '2026-10-15T09:30:00.000Z',
        });
        return ok({ settlement: { order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: 0 } });
      },
    });
    expect(await screen.findByText('LKR 0 to collect - paid by wallet')).toBeInTheDocument();
    expect(screen.queryByText('Cash to collect')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm delivery code' }));
    const sheet = screen.getByRole('dialog', { name: 'Confirm the delivery code' });
    expect(sheet).toHaveTextContent('LKR 0 to collect - paid by wallet');
    expect(sheet).not.toHaveTextContent('Count it');
    await user.type(within(sheet).getByLabelText("Customer's delivery code"), '4821');
    await user.click(within(sheet).getByRole('button', { name: 'Code checked — complete' }));
    expect(await screen.findByText('Paid by wallet — no cash collected')).toBeInTheDocument();
    expect(api.find('POST', '/riders/deliveries/d-1/collect-cod')[0].body).toEqual({ amount: 0, delivery_code: '4821' });
  });

  it('part paid by the wallet: the cash to collect is the rest, with a "Wallet paid" line', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ ...atDoor, total_amount: 400, wallet_amount_used: 750 }) }),
    });
    expect(await screen.findByText('Wallet paid LKR 750')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cash to collect' })).toHaveTextContent('LKR 400');
    expect(screen.getByRole('button', { name: 'Collect LKR 400' })).toBeInTheDocument();
  });

  it('the home card shows the paid-by-wallet note instead of cash to collect', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY', total_amount: 0, wallet_amount_used: 1150 })],
        }),
    });
    expect(await screen.findByText('LKR 0 to collect - paid by wallet')).toBeInTheDocument();
    expect(screen.queryByText('Cash to collect')).not.toBeInTheDocument();
  });
});
