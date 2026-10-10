import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import type { OrderMap, PurchaseItem, PurchaseList, SalesDashboard } from '../api/insights';
import { changeOf, purchaseText, whatsappUrl } from '../lib/insights';
import { toKm } from '../pages/OrderMap';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Sales dashboard, delivery heat map and purchase list on the Admin site
 * (owner, 2026-10-10). The SQL is tested in backend/api/tests/
 * ops-insights.test.ts; here, what the pages ask for and show.
 */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderApp(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const hours = (filled: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => ({ hour, orders: filled[hour] ?? 0 }));

function dashboard(overrides: Partial<SalesDashboard> = {}): SalesDashboard {
  return {
    range: 'today',
    timezone: 'Asia/Colombo',
    period: { from: '2026-10-10', to: '2026-10-10' },
    previous_period: { from: '2026-10-09', to: '2026-10-09' },
    order_count: 14,
    delivered_count: 10,
    cancelled_count: 1,
    delivered_revenue: 15400,
    cash_collected: 15000,
    average_basket: 1540,
    orders_by_status: { DELIVERED: 10, PLACED: 3, CANCELLED: 1 },
    previous: { order_count: 10, delivered_count: 8, cancelled_count: 0, delivered_revenue: 16000, cash_collected: 15000, average_basket: 2000 },
    change: { order_count: 40, delivered_count: 25, cancelled_count: null, delivered_revenue: -3.8, cash_collected: 0, average_basket: -23 },
    discount_given: 0,
    delivery_fees: 1000,
    top_by_quantity: [{ product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 }],
    top_by_revenue: [{ product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 }],
    orders_by_hour: hours({ 9: 5, 18: 7 }),
    ...overrides,
  };
}

const catalogEmpty = (c: Call): Reply | undefined => {
  if (c.path === '/admin/products') return ok({ products: [] });
  if (c.path === '/admin/categories') return ok({ categories: [] });
  if (c.path === '/admin/promotions') return ok({ promotions: [] });
  return undefined;
};

describe('rules', () => {
  it('changes, WhatsApp text and the km projection', () => {
    expect(changeOf(-3.8).text).toBe('↓ 3.8%');
    expect(purchaseText('A', [])).toBe('Blynk order for A:');
    expect(whatsappUrl('hi', '+94771110000')).toBe('https://wa.me/94771110000?text=hi');
    const p = toKm({ lat: 6.4351, lng: 80.0243 }, { lat: 6.4351 + 1 / 111.32, lng: 80.0243 });
    expect(p.y).toBeCloseTo(1, 6);
    expect(p.x).toBeCloseTo(0, 6);
  });
});

describe('Dashboard sales panel', () => {
  it('leads the Dashboard with figures, ↑/↓ changes, status bars and top products; ranges reload', async () => {
    const user = userEvent.setup();
    const api = renderApp('/', (c) => {
      if (c.path === '/admin/reports/dashboard') {
        return ok(c.query.get('range') === 'this_month' ? dashboard({ range: 'this_month', order_count: 300 }) : dashboard());
      }
      return catalogEmpty(c);
    });
    const panel = (await screen.findByRole('heading', { name: 'Sales' })).closest('section')!;
    expect(await within(panel).findByText('LKR 15,400')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Orders up 40 percent')).toHaveTextContent('↑ 40%');
    expect(within(panel).getByLabelText('Average basket down 23 percent')).toHaveTextContent('↓ 23%');
    expect(within(panel).getByLabelText('Cash collected no change')).toHaveTextContent('0%');
    expect(within(within(panel).getByRole('list', { name: 'Orders by status' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Placed3',
      'Delivered10',
      'Cancelled1',
    ]);
    expect(within(panel).getByRole('list', { name: 'Top products by quantity' })).toHaveTextContent('Milk 1L');
    expect(within(panel).getByRole('link', { name: 'Delivery map' })).toHaveAttribute('href', '/order-map');
    // The catalog summary still follows.
    expect(await screen.findByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'This month' }));
    expect(await within(panel).findByText('300')).toBeInTheDocument();
    expect(within(panel).getByText(/compared vs the same days last month/)).toBeInTheDocument();
    expect(api.find('GET', '/admin/reports/dashboard').map((c) => c.query.get('range'))).toEqual(['today', 'this_month']);
  });

  it('a sales failure leaves the rest of the Dashboard working', async () => {
    renderApp('/', catalogEmpty);
    expect(await screen.findByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();
    const panel = screen.getByRole('heading', { name: 'Sales' }).closest('section')!;
    await waitFor(() => expect(panel.querySelector('.field__error')).not.toBeNull());
    expect(within(panel).queryByText('Cash collected')).not.toBeInTheDocument();
  });
});

const MAP: OrderMap = {
  range: 'last_30_days',
  status: 'delivered',
  timezone: 'Asia/Colombo',
  period: { from: '2026-09-11', to: '2026-10-10' },
  cell_meters: 150,
  cell_degrees: 0.00135,
  edge_km: 0.5,
  store: { name: 'Dharga Town', lat: 6.4351, lng: 80.0243, radius_km: 4 },
  totals: { orders: 20, revenue: 30000, inside: 14, near_edge: 5, outside: 1, farthest_km: 4.6, cells: 2 },
  cells: [
    { lat: 6.43568, lng: 80.02498, orders: 19, delivered: 19, revenue: 29000, area: 'Dharga Town', distance_km: 0.1, zone: 'inside' },
    { lat: 6.43568, lng: 80.06548, orders: 1, delivered: 1, revenue: 1000, area: 'Matugama', distance_km: 4.6, zone: 'outside' },
  ],
  busiest: [],
};
MAP.busiest = MAP.cells;

describe('Delivery map', () => {
  it('plots the cells around the radius, lists the busiest areas and the edge counts', async () => {
    const user = userEvent.setup();
    const api = renderApp('/order-map', (c) => (c.path === '/admin/reports/order-map' ? ok({ ...MAP, status: c.query.get('status') }) : undefined));
    expect(await screen.findByRole('img', { name: /20 orders in 2 areas around the store; 1 outside the 4 km radius/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('map-cell').map((c) => c.getAttribute('data-orders'))).toEqual(['19', '1']);
    expect(screen.getByText('1 order was outside the 4 km radius. Farthest: 4.6 km.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Busiest areas' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Dharga Town');
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('Outside');
    expect(api.find('GET', '/admin/reports/order-map')[0].query.toString()).toBe('range=last_30_days&status=delivered');

    await user.click(screen.getByRole('button', { name: 'All orders' }));
    await waitFor(() => expect(api.find('GET', '/admin/reports/order-map').at(-1)!.query.get('status')).toBe('all'));
  });
});

function item(overrides: Partial<PurchaseItem>): PurchaseItem {
  return {
    product_id: 'p-sugar',
    product_name: 'Sugar',
    product_sku: 'SUG-1',
    product_unit: '1 kg',
    pack_size: null,
    category_name: 'Grocery',
    quantity_on_hand: 2,
    quantity_reserved: 0,
    quantity_available: 2,
    low_stock_threshold: 6,
    target_level: 12,
    stock_state: 'LOW',
    suggested_quantity: 10,
    unit_cost: 250,
    estimated_cost: 2500,
    supplier_id: 's1',
    supplier_name: 'Lanka Wholesale',
    supplier_phone: '+94771110000',
    ...overrides,
  };
}

describe('Purchase list', () => {
  it('shows the rule, groups by supplier, and edited quantities flow into cost and WhatsApp', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const SUGAR = item({});
    const SOAP = item({ product_id: 'p-soap', product_name: 'Soap', product_unit: '1 pc', suggested_quantity: 1, unit_cost: 90, estimated_cost: 90, supplier_id: null, supplier_name: null, supplier_phone: null });
    const list: PurchaseList = {
      rule: 'Suggested = 2 × low-stock level − available (on hand minus reserved), at least 1.',
      items: [SUGAR, SOAP],
      suppliers: [
        { supplier_id: 's1', supplier_name: 'Lanka Wholesale', supplier_phone: '+94771110000', items: [SUGAR], estimated_cost: 2500 },
        { supplier_id: null, supplier_name: null, supplier_phone: null, items: [SOAP], estimated_cost: 90 },
      ],
      totals: { products: 2, out: 0, units: 11, estimated_cost: 2590 },
    };
    renderApp('/purchase-list', (c) => (c.path === '/admin/inventory/purchase-list' ? ok(list) : undefined));

    const lanka = await screen.findByRole('region', { name: 'Lanka Wholesale' });
    expect(screen.getByText(/2 × low-stock level − available/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'No supplier yet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase totals')).toHaveTextContent('LKR 2,590');

    const qty = within(lanka).getByLabelText('Sugar quantity');
    await user.clear(qty);
    await user.type(qty, '4');
    expect(qty).toHaveValue('4');
    expect(screen.getByLabelText('Purchase totals')).toHaveTextContent('LKR 1,090');
    expect(within(lanka).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/94771110000?text=${encodeURIComponent('Blynk order for Lanka Wholesale:\n4 × Sugar (1 kg)')}`
    );
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(writeText).toHaveBeenCalledWith('Blynk order for Lanka Wholesale:\n4 × Sugar (1 kg)\n\nBlynk order for supplier:\n1 × Soap (1 pc)');
    expect(await screen.findByText('Purchase list copied.')).toBeInTheDocument();
  });

  it('is in the sidebar', async () => {
    renderApp('/purchase-list', (c) => (c.path === '/admin/inventory/purchase-list' ? ok({ rule: 'r', items: [], suppliers: [], totals: { products: 0, out: 0, units: 0, estimated_cost: 0 } }) : undefined));
    expect(await screen.findByText('Nothing is running low')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchase list' })).toHaveAttribute('href', '/purchase-list');
  });
});
