import { cleanup, configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { OrderDetail } from '../api/types';
import { canWaiveDeliveryFee } from '../components/OrderFreeDelivery';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * "Make delivery free" in Operations (owner, 2026-10-21; Ops is the backup
 * admin): a confirm dialog with the fee and the new total, an optional
 * reason, then the page re-reads the order and the bill says "Free (waived
 * by staff)".
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    order_number: 'BL-20261021-0007',
    order_status: 'PACKED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 1000,
    delivery_fee: 150,
    discount_amount: 0,
    total_amount: 1150,
    placed_at: '2026-10-21T07:00:00.000Z',
    scheduled_for: null,
    delivery_recipient_name: 'Fathima Rizna',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: 'No. 1, Main Street',
    delivery_address_line2: null,
    delivery_city: 'Beruwala',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PACKED' }],
    history: [],
    delivery: null,
    delivery_fee_waiver: null,
    ...over,
  } as OrderDetail;
}

const WAIVED = order({
  delivery_fee: 0,
  total_amount: 1000,
  delivery_fee_waiver: { original_fee: 150, reason: 'Late last time', waived_by_name: 'Ops Person', waived_at: '2026-10-21T08:00:00.000Z' },
});

describe('canWaiveDeliveryFee', () => {
  it('open cash-on-delivery orders with a fee only', () => {
    expect(canWaiveDeliveryFee(order())).toBe(true);
    expect(canWaiveDeliveryFee(order({ order_status: 'PLACED' }))).toBe(true);
    expect(canWaiveDeliveryFee(order({ order_status: 'OUT_FOR_DELIVERY' }))).toBe(true);
    expect(canWaiveDeliveryFee(order({ order_status: 'DELIVERED', payment_status: 'PAID' }))).toBe(false);
    expect(canWaiveDeliveryFee(order({ order_status: 'FAILED' }))).toBe(false);
    expect(canWaiveDeliveryFee(order({ payment_method: 'ONLINE', payment_status: 'PAID' }))).toBe(false);
    expect(canWaiveDeliveryFee(order({ delivery_fee: 0 }))).toBe(false);
  });
});

describe('Order detail - Make delivery free', () => {
  it('confirms with the fee and new total, sends the reason, then shows the free delivery', async () => {
    const user = userEvent.setup();
    let waived = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: waived ? WAIVED : order() }),
      'POST /admin/orders/:id/waive-delivery-fee': () => {
        waived = true;
        return ok({ order: WAIVED });
      },
    });
    expect(await screen.findByTestId('bill-delivery')).toHaveTextContent('LKR 150');

    await user.click(screen.getByRole('button', { name: 'Make delivery free' }));
    const dialog = screen.getByRole('dialog', { name: 'Make delivery free' });
    expect(dialog).toHaveTextContent('Delivery fee now LKR 150');
    expect(within(dialog).getByTestId('free-delivery-new-total')).toHaveTextContent('LKR 1,000');
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), 'Late last time');
    await user.click(within(dialog).getByRole('button', { name: 'Make delivery free' }));

    expect(await screen.findByTestId('delivery-waived')).toHaveTextContent('Delivery made free by Ops Person (was LKR 150) - Late last time');
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')[0]?.body).toEqual({ reason: 'Late last time' });
    expect(screen.getByTestId('bill-delivery')).toHaveTextContent('Free (waived by staff)');
    expect(screen.getByTestId('order-amount-due')).toHaveTextContent('LKR 1,000');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make delivery free' })).not.toBeInTheDocument();
  });

  it('Back closes without sending; no reason sends an empty body', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'POST /admin/orders/:id/waive-delivery-fee': () => ok({ order: WAIVED }),
    });
    await user.click(await screen.findByRole('button', { name: 'Make delivery free' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Make delivery free' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make delivery free' }));
    await vi.waitFor(() => expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')).toHaveLength(1));
    expect(api.find('POST', '/admin/orders/o1/waive-delivery-fee')[0]?.body).toEqual({});
  });

  it("shows the server's refusal and the order as it now is", async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'POST /admin/orders/:id/waive-delivery-fee': () =>
        fail(409, 'ORDER_NOT_OPEN', 'Delivery can only be made free before the order is delivered or closed.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Make delivery free' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make delivery free' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Delivery can only be made free before the order is delivered or closed.');
  });

  it('is not offered on a delivered order', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order({ order_status: 'DELIVERED', payment_status: 'PAID' }) }),
    });
    await screen.findByTestId('bill-delivery');
    expect(screen.queryByRole('button', { name: 'Make delivery free' })).not.toBeInTheDocument();
  });
});
