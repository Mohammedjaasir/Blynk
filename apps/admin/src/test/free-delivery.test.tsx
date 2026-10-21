import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderPanel } from '../components/OrderPanel';
import { canWaiveDeliveryFee } from '../components/OrderFreeDelivery';
import { tokenStore } from '../api/client';
import type { BoardOrder } from '../api/types';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * "Make delivery free" (owner, 2026-10-21): Admin and Operations waive one
 * open cash-on-delivery order's delivery fee from the order panel - a
 * confirm step with the fee and the new total, an optional reason, then the
 * panel re-reads the order and the bill says "Free (waived by staff)".
 */

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const board: BoardOrder = {
  id: 'o1',
  order_number: 'BL-20261021-0007',
  order_status: 'PACKED',
  total_amount: 1150,
  placed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  scheduled_for: null,
  delivery_recipient_name: 'Nimal Perera',
  delivery_address_line1: 'No. 1, Test Lane',
  delivery_city: 'Dharga Town',
  items_summary: { total: 1, pending: 0, sourced: 0, packed: 1, unavailable: 0, substituted: 0 },
  active_delivery: null,
  payment_method: 'COD',
  payment_status: 'PENDING',
};

const charged = {
  ...board,
  subtotal_amount: 1000,
  delivery_fee: 150,
  delivery_recipient_phone: '+94771234567',
  delivery_address_line2: null,
  delivery_instructions: null,
  cancellation_reason: null,
  items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 1, item_status: 'PACKED', actual_unit_cost: null }],
  history: [],
  delivery: null,
  delivery_fee_waiver: null,
};

const waived = {
  ...charged,
  delivery_fee: 0,
  total_amount: 1000,
  delivery_fee_waiver: { original_fee: 150, reason: 'Late last time', waived_by_name: 'Ops Lead', waived_at: new Date().toISOString() },
};

function orderApi(extra: (call: Call, state: { waived: boolean }) => Reply | undefined = () => undefined) {
  const state = { waived: false };
  const api = mockApi((c) => {
    const r = extra(c, state);
    if (r) return r;
    if (c.method === 'GET' && c.path === '/admin/orders/o1') return ok({ order: state.waived ? waived : charged });
    if (c.method === 'POST' && c.path === '/admin/orders/o1/waive-delivery-fee') {
      state.waived = true;
      return ok({ order: waived });
    }
    return undefined;
  });
  return api;
}

const renderOrder = (role: 'ADMIN' | 'OPERATIONS' | 'PACKING_STAFF' = 'ADMIN') =>
  render(<OrderPanel order={board} role={role} version={0} busy={false} onAction={() => {}} onClose={() => {}} />);

describe('canWaiveDeliveryFee', () => {
  const base = { order_status: 'PLACED' as const, payment_method: 'COD' as const, payment_status: 'PENDING', delivery_fee: 100 };
  it('open COD orders with a fee, for Admin and Operations only', () => {
    expect(canWaiveDeliveryFee(base, 'ADMIN')).toBe(true);
    expect(canWaiveDeliveryFee({ ...base, order_status: 'OUT_FOR_DELIVERY' }, 'OPERATIONS')).toBe(true);
    expect(canWaiveDeliveryFee(base, 'PACKING_STAFF')).toBe(false);
    expect(canWaiveDeliveryFee({ ...base, order_status: 'DELIVERED' }, 'ADMIN')).toBe(false);
    expect(canWaiveDeliveryFee({ ...base, order_status: 'CANCELLED' }, 'ADMIN')).toBe(false);
    expect(canWaiveDeliveryFee({ ...base, payment_method: 'ONLINE', payment_status: 'PAID' }, 'ADMIN')).toBe(false);
    expect(canWaiveDeliveryFee({ ...base, delivery_fee: 0 }, 'ADMIN')).toBe(false);
  });
});

describe('Order panel - Make delivery free', () => {
  it('confirms with the fee and new total, sends the reason, then shows the free delivery', async () => {
    const user = userEvent.setup();
    const api = orderApi();
    renderOrder('OPERATIONS');
    expect(await screen.findByTestId('bill-delivery')).toHaveTextContent('LKR 150');

    await user.click(screen.getByRole('button', { name: 'Make delivery free' }));
    const form = screen.getByRole('form', { name: 'Make delivery free' });
    expect(form).toHaveTextContent('Delivery fee now');
    expect(form).toHaveTextContent('LKR 150');
    expect(within(form).getByTestId('free-delivery-new-total')).toHaveTextContent('LKR 1,000');
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')).toHaveLength(0);

    await user.type(within(form).getByLabelText(/Reason/), 'Late last time');
    await user.click(within(form).getByRole('button', { name: 'Make delivery free' }));

    expect(await screen.findByTestId('delivery-waived')).toHaveTextContent('Delivery made free by Ops Lead (was LKR 150) - Late last time');
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')[0]?.body).toEqual({ reason: 'Late last time' });
    expect(screen.getByTestId('bill-delivery')).toHaveTextContent('Free (waived by staff)');
    expect(screen.queryByRole('button', { name: 'Make delivery free' })).not.toBeInTheDocument();
    // Re-read after the change.
    expect(api.find('GET', '/admin/orders/o1').length).toBeGreaterThanOrEqual(2);
  });

  it('sends no reason when none is typed, and Back closes the confirm step', async () => {
    const user = userEvent.setup();
    const api = orderApi();
    renderOrder('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Make delivery free' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('form', { name: 'Make delivery free' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make delivery free' }));
    await user.click(within(screen.getByRole('form', { name: 'Make delivery free' })).getByRole('button', { name: 'Make delivery free' }));
    await screen.findByTestId('delivery-waived');
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')[0]?.body).toEqual({});
  });

  it("shows the server's refusal", async () => {
    const user = userEvent.setup();
    orderApi((c) =>
      c.method === 'POST' && c.path === '/admin/orders/o1/waive-delivery-fee'
        ? fail(409, 'DELIVERY_ALREADY_FREE', 'Delivery is already free on this order (its coupon).')
        : undefined
    );
    renderOrder('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Make delivery free' }));
    await user.click(within(screen.getByRole('form', { name: 'Make delivery free' })).getByRole('button', { name: 'Make delivery free' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Delivery is already free on this order (its coupon).');
  });

  it('is not offered to packing staff', async () => {
    orderApi();
    renderOrder('PACKING_STAFF');
    await screen.findByTestId('bill-delivery');
    expect(screen.queryByRole('button', { name: 'Make delivery free' })).not.toBeInTheDocument();
  });
});
