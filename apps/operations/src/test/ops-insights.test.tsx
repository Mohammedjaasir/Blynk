import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { OrderMap, PurchaseItem, PurchaseList, SalesDashboard } from '../api/insights';
import {
  changeOf,
  circlePolygon,
  lineName,
  purchaseCsv,
  purchaseText,
  radiusAdvice,
  suggestedQuantity,
  whatsappUrl,
} from '../lib/insights';
import { ADMIN_NO_RIDER, ok, renderAs } from './helpers';

/**
 * Sales dashboard, delivery heat map and purchase list (owner, 2026-10-10).
 * The figures and their SQL are tested against PostgreSQL in
 * backend/api/tests/ops-insights.test.ts; here, the rules in lib/insights
 * and what each screen asks for and shows.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
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
    top_by_quantity: [
      { product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 },
      { product_id: 'p2', name: 'Bread', quantity: 9, revenue: 1350 },
    ],
    top_by_revenue: [{ product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 }],
    orders_by_hour: hours({ 9: 5, 18: 7 }),
    ...overrides,
  };
}

function purchaseItem(overrides: Partial<PurchaseItem>): PurchaseItem {
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
    supplier_phone: '+94 77 111 0000',
    ...overrides,
  };
}

const SUGAR = purchaseItem({});
const DHAL = purchaseItem({ product_id: 'p-dhal', product_name: 'Dhal', product_unit: '500 g', product_sku: 'DHL-1', quantity_on_hand: 0, quantity_available: 0, low_stock_threshold: 3, target_level: 6, stock_state: 'OUT', suggested_quantity: 6, unit_cost: 180, estimated_cost: 1080 });
const SOAP = purchaseItem({ product_id: 'p-soap', product_name: 'Soap, "Lux"', product_unit: '1 pc', product_sku: 'SOP-1', suggested_quantity: 1, unit_cost: 90, estimated_cost: 90, supplier_id: null, supplier_name: null, supplier_phone: null });

const PURCHASE: PurchaseList = {
  rule: 'Suggested = 2 × low-stock level − available (on hand minus reserved), at least 1. It brings the product back to twice its low-stock level.',
  items: [DHAL, SUGAR, SOAP],
  suppliers: [
    { supplier_id: 's1', supplier_name: 'Lanka Wholesale', supplier_phone: '+94 77 111 0000', items: [DHAL, SUGAR], estimated_cost: 3580 },
    { supplier_id: null, supplier_name: null, supplier_phone: null, items: [SOAP], estimated_cost: 90 },
  ],
  totals: { products: 3, out: 1, units: 17, estimated_cost: 3670 },
};

const MAP: OrderMap = {
  range: 'last_30_days',
  status: 'delivered',
  timezone: 'Asia/Colombo',
  period: { from: '2026-09-11', to: '2026-10-10' },
  cell_meters: 150,
  cell_degrees: 0.00135,
  edge_km: 0.5,
  store: { name: 'Dharga Town', lat: 6.4351, lng: 80.0243, radius_km: 4 },
  totals: { orders: 20, revenue: 30000, inside: 14, near_edge: 5, outside: 1, farthest_km: 4.6, cells: 3 },
  cells: [
    { lat: 6.43568, lng: 80.02498, orders: 12, delivered: 12, revenue: 18000, area: 'Dharga Town', distance_km: 0.1, zone: 'inside' },
    { lat: 6.46808, lng: 80.02498, orders: 7, delivered: 7, revenue: 11000, area: 'Aluthgama', distance_km: 3.7, zone: 'near_edge' },
    { lat: 6.43568, lng: 80.06548, orders: 1, delivered: 1, revenue: 1000, area: 'Matugama', distance_km: 4.6, zone: 'outside' },
  ],
  busiest: [],
};
MAP.busiest = MAP.cells;

describe('insights rules', () => {
  it('change arrows', () => {
    expect(changeOf(12.5)).toMatchObject({ text: '↑ 12.5%', tone: 'up' });
    expect(changeOf(-5)).toMatchObject({ text: '↓ 5%', tone: 'down' });
    expect(changeOf(250)).toMatchObject({ text: '↑ 250%' });
    expect(changeOf(0)).toMatchObject({ text: '0%', tone: 'flat' });
    expect(changeOf(null)).toMatchObject({ text: '—', tone: 'flat' });
  });

  it('suggested quantity: 2 × threshold − available, at least 1', () => {
    expect(suggestedQuantity(6, 2)).toBe(10);
    expect(suggestedQuantity(0, 0)).toBe(1);
    expect(suggestedQuantity(3, 9)).toBe(1);
  });

  it('WhatsApp text, link and CSV', () => {
    const text = purchaseText('Lanka Wholesale', [
      { item: SUGAR, quantity: 10 },
      { item: DHAL, quantity: 0 },
      { item: purchaseItem({ product_name: 'Sugar 1 kg' }), quantity: 2 },
    ]);
    expect(text).toBe('Blynk order for Lanka Wholesale:\n10 × Sugar (1 kg)\n2 × Sugar 1 kg');
    expect(lineName(purchaseItem({ pack_size: '5 kg bag' }))).toBe('Sugar (5 kg bag)');
    expect(whatsappUrl('a b\n1', '+94 77 111 0000')).toBe('https://wa.me/94771110000?text=a%20b%0A1');
    expect(whatsappUrl('x')).toBe('https://wa.me/?text=x');
    const csv = purchaseCsv([
      { item: SOAP, quantity: 3 },
      { item: DHAL, quantity: 0 },
    ]).split('\r\n');
    expect(csv[0]).toBe('Supplier,Product,SKU,Unit,Available,Low-stock level,Quantity,Unit cost (LKR),Estimated cost (LKR)');
    expect(csv[1]).toBe('No supplier yet,"Soap, ""Lux""",SOP-1,1 pc,2,6,3,90.00,270.00');
    expect(csv).toHaveLength(3);
  });

  it('radius ring and advice', () => {
    const ring = circlePolygon(6.4351, 80.0243, 4, 4);
    expect(ring).toHaveLength(5);
    expect(ring[0][1]).toBeCloseTo(6.4351, 4);
    expect(ring[1][1]).toBeCloseTo(6.4351 + 4 / 111.32, 4);
    expect(radiusAdvice({ orders: 0, near_edge: 0, outside: 0 }, 4, 0.5)).toBe('No orders in this period.');
    expect(radiusAdvice({ orders: 10, near_edge: 1, outside: 2 }, 4, 0.5)).toBe('2 orders were outside the 4 km radius.');
    expect(radiusAdvice({ orders: 10, near_edge: 3, outside: 0 }, 4, 0.5)).toMatch(/30% of orders came from the last 0.5 km/);
    expect(radiusAdvice({ orders: 10, near_edge: 1, outside: 0 }, 4, 0.5)).toBe('Most orders come from well inside the 4 km radius.');
  });
});

describe('Sales on Home and the dashboard', () => {
  it('Home leads with today\'s sales against yesterday, opening the dashboard', async () => {
    const { api } = renderAs(ADMIN_NO_RIDER, '/', { 'GET /admin/reports/dashboard': () => ok(dashboard()) });
    const card = (await screen.findByRole('heading', { name: 'Sales today' })).closest('section')!;
    expect(api.find('GET', '/admin/reports/dashboard')[0].query).toEqual({ range: 'today' });
    expect(within(card).getByText('LKR 15,400')).toBeInTheDocument();
    expect(within(card).getByLabelText('Orders up 40 percent')).toHaveTextContent('↑ 40%');
    expect(within(card).getByLabelText('Delivered sales down 3.8 percent')).toHaveTextContent('↓ 3.8%');
    expect(within(card).getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', '/dashboard');
    // Home's own sections are still there.
    expect(screen.getByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();
  });

  it('Home without access to sales shows no card and no error', async () => {
    renderAs(ADMIN_NO_RIDER, '/');
    expect(await screen.findByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sales today' })).not.toBeInTheDocument();
  });

  it('the dashboard: figures, status bars, peak hour, top products, and ranges', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_NO_RIDER, '/dashboard', {
      'GET /admin/reports/dashboard': (call) =>
        ok(call.query.range === 'this_week' ? dashboard({ range: 'this_week', order_count: 80, change: { ...dashboard().change, order_count: null } }) : dashboard()),
    });
    expect(await screen.findByText('Cash collected')).toBeInTheDocument();
    expect(screen.getByText('LKR 1,540')).toBeInTheDocument();
    expect(screen.getByText('Compared vs yesterday.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Busiest at 18:00 with 7 orders/ })).toBeInTheDocument();
    expect(screen.getByTestId('hour-9')).toHaveAttribute('data-orders', '5');
    const status = screen.getByRole('heading', { name: 'Orders by status' }).closest('section')!;
    expect(within(status).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Placed3', 'Delivered10', 'Cancelled1']);
    const byQty = screen.getByRole('list', { name: 'Top products by quantity' });
    expect(within(byQty).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Milk 1L14 sold', 'Bread9 sold']);
    expect(screen.getByRole('link', { name: /Delivery map/ })).toHaveAttribute('href', '/dashboard/map');

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(await screen.findByText('80')).toBeInTheDocument();
    expect(screen.getByText('Compared vs the same days last week.')).toBeInTheDocument();
    expect(screen.getByLabelText('Orders nothing to compare with')).toHaveTextContent('—');
    expect(api.find('GET', '/admin/reports/dashboard').map((c) => c.query.range)).toEqual(['today', 'this_week']);
  });
});

describe('Delivery map', () => {
  it('draws the hub, radius and bubbles; lists zones and the busiest areas; switches status', async () => {
    const user = userEvent.setup();
    const { mapInstances } = (await import('maplibre-gl')) as unknown as {
      mapInstances: { options: { center: [number, number] }; sources: Record<string, { data: any }>; handlers: Record<string, () => void>; markers: unknown[] }[];
    };
    const before = mapInstances.length;
    const { api } = renderAs(ADMIN_NO_RIDER, '/dashboard/map', {
      'GET /admin/reports/order-map': (call) => ok({ ...MAP, status: call.query.status, totals: { ...MAP.totals, orders: call.query.status === 'all' ? 25 : 20 } }),
    });
    expect(await screen.findByTestId('order-map')).toBeInTheDocument();
    expect(api.find('GET', '/admin/reports/order-map')[0].query).toEqual({ range: 'last_30_days', status: 'delivered' });

    const m = mapInstances[mapInstances.length - 1];
    expect(mapInstances.length).toBe(before + 1);
    expect(m.options.center).toEqual([80.0243, 6.4351]);
    expect(m.markers).toHaveLength(1);
    m.handlers.load();
    expect(m.sources.radius.data.geometry.type).toBe('Polygon');
    expect(m.sources.cells.data.features).toHaveLength(3);
    expect(m.sources.cells.data.features[0].properties).toEqual({ orders: 12, weight: 1 });

    expect(screen.getByText('Service radius · 4 km')).toBeInTheDocument();
    expect(screen.getByText('Near the edge (last 0.5 km)').previousSibling).toHaveTextContent('5');
    expect(screen.getByRole('status')).toHaveTextContent('1 order was outside the 4 km radius. Farthest: 4.6 km.');
    const busiest = screen.getByRole('heading', { name: 'Busiest areas' }).closest('section')!;
    expect(within(busiest).getAllByRole('listitem')[0]).toHaveTextContent('Dharga Town');
    expect(within(busiest).getAllByRole('listitem')[0]).toHaveTextContent('12 orders');

    await user.click(screen.getByRole('button', { name: 'All orders' }));
    await waitFor(() => expect(api.find('GET', '/admin/reports/order-map').map((c) => c.query.status)).toEqual(['delivered', 'all']));
    await user.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(api.find('GET', '/admin/reports/order-map').at(-1)!.query).toEqual({ range: 'last_90_days', status: 'all' }));
  });
});

describe('Purchase list', () => {
  it('groups by supplier, explains the rule, and quantities drive cost, WhatsApp text and copy', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAs(ADMIN_NO_RIDER, '/catalog/inventory/purchase-list', { 'GET /admin/inventory/purchase-list': () => ok(PURCHASE) });

    const lanka = await screen.findByRole('region', { name: 'Lanka Wholesale' });
    expect(screen.getByText(/2 × low-stock level − available/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'No supplier yet' })).toBeInTheDocument();
    expect(within(lanka).getByText('LKR 3,580')).toBeInTheDocument();
    expect(within(lanka).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/94771110000?text=${encodeURIComponent('Blynk order for Lanka Wholesale:\n6 × Dhal (500 g)\n10 × Sugar (1 kg)')}`
    );

    await user.click(within(lanka).getByRole('button', { name: 'More Sugar' }));
    await user.click(within(lanka).getByRole('button', { name: 'Less Dhal' }));
    expect(within(lanka).getByLabelText('Sugar quantity')).toHaveValue('11');
    expect(within(lanka).getByText('LKR 3,650')).toBeInTheDocument(); // 5 × 180 + 11 × 250
    const qty = within(lanka).getByLabelText('Dhal quantity');
    await user.clear(qty);
    expect(qty).toHaveValue('0');
    expect(within(lanka).getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toBe(
      `https://wa.me/94771110000?text=${encodeURIComponent('Blynk order for Lanka Wholesale:\n11 × Sugar (1 kg)')}`
    );

    await user.click(within(lanka).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Blynk order for Lanka Wholesale:\n11 × Sugar (1 kg)');
    expect(await screen.findByText('Order for Lanka Wholesale copied.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(writeText).toHaveBeenLastCalledWith('Blynk order for Lanka Wholesale:\n11 × Sugar (1 kg)\n\nBlynk order for supplier:\n1 × Soap, "Lux" (1 pc)');
  });

  it('downloads the list as CSV, and says so when nothing is low', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderAs(ADMIN_NO_RIDER, '/catalog/inventory/purchase-list', { 'GET /admin/inventory/purchase-list': () => ok(PURCHASE) });
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(text).toContain('Lanka Wholesale,Sugar,SUG-1,1 kg,2,6,10,250.00,2500.00');
    cleanup();

    renderAs(ADMIN_NO_RIDER, '/catalog/inventory/purchase-list', {
      'GET /admin/inventory/purchase-list': () => ok({ ...PURCHASE, items: [], suppliers: [], totals: { products: 0, out: 0, units: 0, estimated_cost: 0 } }),
    });
    expect(await screen.findByText('Nothing is running low. No purchase needed.')).toBeInTheDocument();
  });

  it('is reachable from Inventory and Running low', async () => {
    renderAs(ADMIN_NO_RIDER, '/catalog/inventory/low-stock');
    expect(await screen.findByRole('link', { name: 'Purchase list' })).toHaveAttribute('href', '/catalog/inventory/purchase-list');
    cleanup();
    renderAs(ADMIN_NO_RIDER, '/catalog/inventory');
    expect((await screen.findByText('Purchase list')).closest('a')).toHaveAttribute('href', '/catalog/inventory/purchase-list');
  });
});
