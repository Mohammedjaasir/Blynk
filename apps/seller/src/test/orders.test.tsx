import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SellerProvider } from '../auth/SellerContext';
import { OrdersProvider, useOrders } from '../auth/OrdersContext';
import type { ForegroundMessage, PushManager } from '../lib/push/manager';
import { fail, mockApi, ok } from './mockApi';
import { order, renderApp, ROUTER_FUTURE, seller, signInStoredSession, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());
afterEach(() => vi.useRealTimers());

const NEW_ORDER = order();
const READY_ORDER = order({ id: 'o2', order_number: '1280', status: 'READY', can_mark_ready: false, ready_at: '2026-10-30T07:00:00.000Z' });
const MIXED_ORDER = order({ id: 'o3', order_number: '1290', can_mark_ready: false, seller_amount: 300.5 });
const ON_THE_WAY = order({ id: 'o4', order_number: '1270', status: 'ON_THE_WAY', can_mark_ready: false });
const DELIVERED = order({ id: 'o5', order_number: '1250', status: 'DELIVERED', can_mark_ready: false });
const CANCELLED = order({ id: 'o6', order_number: '1240', status: 'CANCELLED', can_mark_ready: false });

describe('the Orders tab', () => {
  it('is between My products and My stock, and a notification tap on /orders opens it', async () => {
    mockApi(worldHandler({ orders: [] }));
    renderApp('/orders');
    expect(await screen.findByRole('heading', { name: /^orders$/i })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/\d+ new orders?/, '').trim())).toEqual([
      'My products',
      'Orders',
      'My stock',
      'Statement',
      'My shop',
    ]);
    expect(within(nav).getByRole('link', { name: /orders/i })).toHaveAttribute('aria-current', 'page');
  });

  it('shows an empty state with no orders and no badge', async () => {
    mockApi(worldHandler({ orders: [] }));
    renderApp('/orders');
    expect(await screen.findByText(/no open orders/i)).toBeInTheDocument();
    expect(document.querySelector('.nav__badge')).toBeNull();
  });

  it('lists each order as a card: number, items x quantity, what the seller earns, a status chip', async () => {
    mockApi(worldHandler({ orders: [NEW_ORDER, READY_ORDER, ON_THE_WAY] }));
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    expect(within(card).getByText('2 x Apple Pie')).toBeInTheDocument();
    expect(within(card).getByText('1 x Samosa')).toBeInTheDocument();
    expect(card).toHaveTextContent('You earn LKR 1,250.00');
    expect(within(card).getByText('New')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Order #1280' })).getByText('Ready')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Order #1270' })).getByText('On the way')).toBeInTheDocument();
  });

  it('never shows customer details', async () => {
    mockApi(
      worldHandler({
        orders: [{ ...NEW_ORDER, customer_name: 'Kamal', customer_phone: '0771111111', address: '5 Lake Road' } as never],
      })
    );
    renderApp('/orders');
    await screen.findByRole('article', { name: 'Order #1283' });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/kamal|0771111111|lake road/i);
  });

  it('puts delivered and cancelled orders under Earlier', async () => {
    mockApi(worldHandler({ orders: [NEW_ORDER, DELIVERED, CANCELLED] }));
    renderApp('/orders');
    await screen.findByRole('article', { name: 'Order #1283' });
    expect(screen.queryByRole('article', { name: 'Order #1250' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /earlier \(2\)/i }));
    const delivered = screen.getByRole('article', { name: 'Order #1250' });
    expect(within(delivered).getByText('Delivered')).toBeInTheDocument();
    const cancelled = screen.getByRole('article', { name: 'Order #1240' });
    expect(within(cancelled).getByText('Cancelled')).toBeInTheDocument();
    expect(cancelled).toHaveTextContent(/no need to prepare it/i);
    expect(cancelled).not.toHaveTextContent(/you earn/i);
    expect(screen.queryByRole('article', { name: 'Order #1283' })).not.toBeInTheDocument();
  });

  it('shows the number of NEW orders as a badge on the tab (and for screen readers)', async () => {
    mockApi(worldHandler({ orders: [NEW_ORDER, order({ id: 'o9', order_number: '1291' }), READY_ORDER] }));
    renderApp('/products');
    const link = await screen.findByRole('link', { name: /orders.*2 new orders/i });
    await waitFor(() => expect(link.querySelector('.nav__badge')).toHaveTextContent('2'));
  });

  it('shows 9+ for many new orders', async () => {
    const many = Array.from({ length: 12 }, (_, i) => order({ id: `n${i}`, order_number: String(2000 + i) }));
    mockApi(worldHandler({ orders: many }));
    renderApp('/products');
    await waitFor(() => expect(document.querySelector('.nav__badge')).toHaveTextContent('9+'));
  });

  it('says so when the orders cannot be loaded, and loads them on Try again', async () => {
    let failing = true;
    mockApi((call) => {
      if (call.path === '/seller/orders' && failing) return fail(500, 'INTERNAL', 'Server error');
      return worldHandler({ orders: [NEW_ORDER] })(call);
    });
    renderApp('/orders');
    expect(await screen.findByRole('alert')).toHaveTextContent(/server error/i);
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('article', { name: 'Order #1283' })).toBeInTheDocument();
  });

  it('does not ask for orders before the shop is approved', async () => {
    const api = mockApi(worldHandler({ seller: seller({ status: 'PENDING' }) }));
    renderApp('/orders');
    expect(await screen.findByText(/once blynk has approved your shop/i)).toBeInTheDocument();
    expect(api.find('GET', '/seller/orders')).toHaveLength(0);
  });

  it('refreshes every 30 seconds while the tab is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi(worldHandler({ orders: [NEW_ORDER] }));
    renderApp('/orders');
    await screen.findByRole('article', { name: 'Order #1283' });
    const before = api.find('GET', '/seller/orders').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(api.find('GET', '/seller/orders').length).toBeGreaterThan(before));
  });

  it('shows a new order that arrives on the next refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let orders = [NEW_ORDER];
    mockApi((call) => (call.path === '/seller/orders' ? ok({ orders }) : worldHandler()(call)));
    renderApp('/orders');
    await screen.findByRole('article', { name: 'Order #1283' });
    orders = [order({ id: 'o7', order_number: '1300' }), NEW_ORDER];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(await screen.findByRole('article', { name: 'Order #1300' })).toBeInTheDocument();
  });
});

describe('Order is ready', () => {
  it('asks first, then tells the rider and shows "Ready, the rider has been told"', async () => {
    const api = mockApi((call) => {
      if (call.method === 'POST' && call.path === '/seller/orders/o1/ready') {
        return ok({ ...NEW_ORDER, status: 'READY', can_mark_ready: false, ready_at: '2026-10-30T09:00:00.000Z' });
      }
      return worldHandler({ orders: [NEW_ORDER] })(call);
    });
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));

    // Nothing is sent until the seller confirms.
    const dialog = await screen.findByRole('dialog', { name: /order is ready\?/i });
    expect(dialog).toHaveTextContent('Tell the rider the order is ready for pick-up?');
    expect(api.find('POST', '/seller/orders/o1/ready')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: /yes, tell the rider/i }));
    await waitFor(() => expect(api.find('POST', '/seller/orders/o1/ready')).toHaveLength(1));
    expect(await within(card).findByText('Ready, the rider has been told')).toBeInTheDocument();
    expect(within(card).getByText('Ready')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /order is ready/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The badge no longer counts it.
    await waitFor(() => expect(document.querySelector('.nav__badge')).toBeNull());
  });

  it('works when the API answers with { order }', async () => {
    mockApi((call) =>
      call.method === 'POST' && call.path === '/seller/orders/o1/ready'
        ? ok({ order: { ...NEW_ORDER, status: 'READY', can_mark_ready: false, ready_at: '2026-10-30T09:00:00.000Z' } })
        : worldHandler({ orders: [NEW_ORDER] })(call)
    );
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));
    await userEvent.click(await screen.findByRole('button', { name: /yes, tell the rider/i }));
    expect(await within(card).findByText('Ready, the rider has been told')).toBeInTheDocument();
  });

  it('"Not yet" closes the question and sends nothing', async () => {
    const api = mockApi(worldHandler({ orders: [NEW_ORDER] }));
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));
    await userEvent.click(await screen.findByRole('button', { name: /not yet/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.find('POST', '/seller/orders/o1/ready')).toHaveLength(0);
    expect(within(card).getByRole('button', { name: /order is ready/i })).toBeInTheDocument();
  });

  it('shows the API refusal on the card (mixed order: Blynk will collect this order)', async () => {
    mockApi((call) =>
      call.method === 'POST' && call.path === '/seller/orders/o1/ready'
        ? fail(409, 'SELLER_ORDER_MIXED', 'mixed')
        : worldHandler({ orders: [NEW_ORDER] })(call)
    );
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));
    await userEvent.click(await screen.findByRole('button', { name: /yes, tell the rider/i }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Blynk will collect this order.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the order is not new any more and refreshes the list when it moved on', async () => {
    let moved = false;
    mockApi((call) => {
      if (call.method === 'POST' && call.path === '/seller/orders/o1/ready') {
        moved = true;
        return fail(409, 'ORDER_NOT_NEW', 'not new');
      }
      return worldHandler({
        orders: [moved ? { ...NEW_ORDER, status: 'READY', can_mark_ready: false } : NEW_ORDER],
      })(call);
    });
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));
    await userEvent.click(await screen.findByRole('button', { name: /yes, tell the rider/i }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(/not new any more/i);
    expect(await within(card).findByText('Ready, the rider has been told')).toBeInTheDocument();
  });

  it('a network failure shows a plain message and the button stays', async () => {
    mockApi((call) => {
      if (call.method === 'POST' && call.path === '/seller/orders/o1/ready') throw new TypeError('network down');
      return worldHandler({ orders: [NEW_ORDER] })(call);
    });
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1283' });
    await userEvent.click(within(card).getByRole('button', { name: /order is ready/i }));
    await userEvent.click(await screen.findByRole('button', { name: /yes, tell the rider/i }));
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /order is ready/i })).toBeInTheDocument();
  });

  it('a mixed order has no Ready button: it says Blynk will collect it', async () => {
    mockApi(worldHandler({ orders: [MIXED_ORDER] }));
    renderApp('/orders');
    const card = await screen.findByRole('article', { name: 'Order #1290' });
    expect(within(card).queryByRole('button', { name: /order is ready/i })).not.toBeInTheDocument();
    expect(card).toHaveTextContent('Blynk will collect this order.');
    expect(card).toHaveTextContent('You earn LKR 300.50');
  });

  it('a ready or delivered order has no Ready button', async () => {
    mockApi(worldHandler({ orders: [READY_ORDER, ON_THE_WAY] }));
    renderApp('/orders');
    await screen.findByRole('article', { name: 'Order #1280' });
    expect(screen.queryByRole('button', { name: /order is ready/i })).not.toBeInTheDocument();
  });
});

describe('orders and push', () => {
  /** A push manager that only holds the foreground listeners, so a test can send a message. */
  function fakeManager() {
    const listeners = new Set<(m: ForegroundMessage) => void>();
    const manager = {
      onForeground(listener: (m: ForegroundMessage) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as PushManager;
    return { manager, send: (m: ForegroundMessage) => listeners.forEach((l) => l(m)) };
  }

  function Count() {
    const { newCount, orders } = useOrders();
    return <p data-testid="count">{orders === null ? 'loading' : String(newCount)}</p>;
  }

  it('looks for orders again when a push arrives while the app is open', async () => {
    let orders = [READY_ORDER];
    const api = mockApi((call) =>
      call.path === '/seller/orders' ? ok({ orders }) : worldHandler()(call)
    );
    const push = fakeManager();
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <SellerProvider>
          <OrdersProvider manager={push.manager}>
            <Count />
          </OrdersProvider>
        </SellerProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    const before = api.find('GET', '/seller/orders').length;

    orders = [NEW_ORDER, READY_ORDER];
    act(() => push.send({ title: 'New order', body: '#1283: 2 x Apple Pie, 1 x Samosa', url: '/orders' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(api.find('GET', '/seller/orders').length).toBeGreaterThan(before);
  });
});
