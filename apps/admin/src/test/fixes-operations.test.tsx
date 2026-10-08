import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { products as productsApi } from '../api/resources';
import { reorderItems } from '../pages/Promotions';
import { handinRiders } from '../pages/Cash';
import { isPackableFromItems, canMarkItemUnavailable } from '../lib/orders';
import { emptyForm, validateForm } from '../lib/coupons';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Fixes 4-7, 9 and 10: ARTWORK promotions, reordering equal display_order,
 * order item / delivery steps, lists that used to cap silently, inactive
 * riders for cash hand-ins, and coupon usage limits.
 */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

/** Signed in as an admin at `route`; `handler` answers everything else. */
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

// ------------------------------------------------------------ 4. ARTWORK
const ARTWORK_URL = 'https://media.blynk.lk/promotions/banner.webp';
function promotion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: 'Avurudu sale',
    subtitle: 'Up to 30% off',
    image_url: null,
    background_type: 'ARTWORK',
    background_color: null,
    background_color_end: null,
    background_image_url: ARTWORK_URL,
    background_focal_x: 50,
    background_focal_y: 20,
    cta_label: null,
    cta_destination_type: 'CATALOG',
    cta_destination_value: null,
    display_order: 10,
    is_active: true,
    ...overrides,
  };
}

describe('ARTWORK promotions', () => {
  it('lists, previews and saves an ARTWORK promotion without dropping its file', async () => {
    const user = userEvent.setup();
    const api = renderApp('/promotions', (c) => {
      if (c.method === 'GET' && c.path === '/admin/promotions') return ok({ promotions: [promotion()] });
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: [] });
      if (c.method === 'PATCH' && c.path === '/admin/promotions/p1') return ok({ promotion: promotion() });
      return undefined;
    });
    expect(await screen.findByText('Full artwork')).toBeInTheDocument();
    expect(screen.getByText('Whole card → all products')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion' });
    expect(within(dialog).getByRole('button', { name: 'Designed banner (full picture)' })).toHaveAttribute('aria-pressed', 'true');

    // The preview draws the banner full-bleed at its focal point, with no headline over it.
    const preview = dialog.querySelector('.promo-preview[data-background="artwork"]') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.style.backgroundImage).toContain(ARTWORK_URL);
    expect(preview.style.backgroundImage).not.toContain('gradient');
    expect(preview.style.backgroundPosition).toBe('50% 20%');
    expect(within(preview).queryByText('Avurudu sale')).toBeNull();

    // A destination with no button label is fine for ARTWORK.
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/promotions/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/promotions/p1')[0]!.body).toMatchObject({
      background_type: 'ARTWORK',
      background_image_url: ARTWORK_URL,
      background_color: null,
      cta_label: null,
      cta_destination_type: 'CATALOG',
    });
  });

  it('switching IMAGE to full artwork keeps the uploaded file', async () => {
    const user = userEvent.setup();
    const api = renderApp('/promotions', (c) => {
      if (c.method === 'GET' && c.path === '/admin/promotions')
        return ok({ promotions: [promotion({ background_type: 'IMAGE', cta_label: 'Shop', cta_destination_type: 'CATALOG' })] });
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: [] });
      if (c.method === 'PATCH') return ok({ promotion: promotion() });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion' });
    await user.click(within(dialog).getByRole('button', { name: 'Designed banner (full picture)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/promotions/p1')[0]?.body).toMatchObject({
        background_type: 'ARTWORK',
        background_image_url: ARTWORK_URL,
      })
    );
    // Nothing deleted: the same file is still in use.
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
  });
});

// ------------------------------------------------------------ 5. reorder
describe('promotion reorder', () => {
  it('swaps distinct orders and normalises equal ones first', () => {
    expect(
      reorderItems(
        [
          { id: 'a', display_order: 1 },
          { id: 'b', display_order: 2 },
        ],
        'a',
        1
      )
    ).toEqual([
      { id: 'a', display_order: 2 },
      { id: 'b', display_order: 1 },
    ]);
    expect(
      reorderItems(
        [
          { id: 'a', display_order: 0 },
          { id: 'b', display_order: 0 },
          { id: 'c', display_order: 0 },
        ],
        'c',
        -1
      )
    ).toEqual([
      { id: 'a', display_order: 10 },
      { id: 'b', display_order: 30 },
      { id: 'c', display_order: 20 },
    ]);
    expect(reorderItems([{ id: 'a', display_order: 0 }], 'a', -1)).toBeNull();
  });

  it('moving between two promotions with the same order really moves', async () => {
    const user = userEvent.setup();
    const api = renderApp('/promotions', (c) => {
      if (c.path === '/admin/promotions/reorder') return ok({ promotions: [] });
      if (c.path === '/admin/promotions')
        return ok({
          promotions: [
            promotion({ id: 'p1', title: 'First', display_order: 0 }),
            promotion({ id: 'p2', title: 'Second', display_order: 0 }),
          ],
        });
      if (c.path === '/admin/categories') return ok({ categories: [] });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Move First down' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/promotions/reorder')[0]?.body).toEqual({
        items: [
          { id: 'p1', display_order: 20 },
          { id: 'p2', display_order: 10 },
        ],
      })
    );
  });
});

// ------------------------------------------------------------- 6 + 7. orders
let seq = 0;
function boardOrder(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `o${seq}`,
    order_number: `BL-20261006-00${10 + seq}`,
    order_status: 'PLACED',
    total_amount: 610,
    placed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_address_line1: '14 Mosque Road',
    delivery_city: 'Dharga Town',
    items_summary: { total: 2, pending: 2, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
    active_delivery: null,
    ...overrides,
  };
}
function detailOf(o: ReturnType<typeof boardOrder>, items: unknown[]) {
  return {
    ...o,
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 560,
    delivery_fee: 50,
    delivery_recipient_phone: '+94771234567',
    delivery_address_line2: null,
    delivery_instructions: null,
    cancellation_reason: null,
    items,
    history: [],
    delivery: null,
  };
}
const page = (orders: unknown[], total: number) => ok({ orders, pagination: { page: 1, limit: 100, total, total_pages: 1 } });

function renderOrders(live: unknown[], handler: (c: Call) => Reply | undefined = () => undefined, liveTotal = live.length) {
  return renderApp('/orders', (c) => {
    if (c.method === 'GET' && c.path === '/admin/orders') {
      const status = c.query.get('status');
      if (status === 'DELIVERED') return page([], 0);
      if (status === 'CANCELLED') return page([], 0);
      return page(live, liveTotal);
    }
    return handler(c);
  });
}

describe('orders: item unavailable and proof of delivery', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('marks a pending item unavailable after a confirmation', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    const items = [
      { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PENDING', actual_unit_cost: null },
      { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', quantity: 1, item_status: 'PACKED', actual_unit_cost: 690 },
    ];
    const api = renderOrders([o], (c) => {
      if (c.method === 'GET' && c.path === `/admin/orders/${o.id}`) return ok({ order: detailOf(o, items) });
      if (c.method === 'POST' && c.path === `/admin/orders/${o.id}/resolve-item`) return ok({ order: o });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    // Only the pending item offers it.
    expect(within(panel).queryByRole('button', { name: 'Mark Pelwatte Butter 200g unavailable' })).toBeNull();
    await user.click(await within(panel).findByRole('button', { name: 'Mark Kotmale Fresh Milk 1L unavailable' }));

    const confirm = screen.getByRole('dialog', { name: 'Mark item unavailable' });
    expect(confirm).toHaveTextContent('2 × Kotmale Fresh Milk 1L');
    expect(api.find('POST', `/admin/orders/${o.id}/resolve-item`)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Mark unavailable' }));
    await waitFor(() =>
      expect(api.find('POST', `/admin/orders/${o.id}/resolve-item`)[0]?.body).toEqual({ item_id: 'i1', item_status: 'UNAVAILABLE' })
    );
  });

  it('mark delivered sends the customer code and no override note', async () => {
    const user = userEvent.setup();
    const o = boardOrder({
      order_status: 'OUT_FOR_DELIVERY',
      active_delivery: { id: 'd1', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan' },
    });
    const api = renderOrders([o], (c) => {
      if (c.method === 'GET' && c.path === `/admin/orders/${o.id}`) return ok({ order: detailOf(o, []) });
      if (c.method === 'PATCH') return ok({ order: o });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    await user.click(within(await screen.findByRole('complementary', { name: /Order #/ })).getByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    await user.type(within(dialog).getByLabelText(/Customer's delivery code/), '4821');
    expect(within(dialog).getByLabelText(/Note/)).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() =>
      expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'DELIVERED', delivery_code: '4821' })
    );
  });

  it('without a code, the note is sent as the override; a wrong code is explained', async () => {
    const user = userEvent.setup();
    const o = boardOrder({
      order_status: 'OUT_FOR_DELIVERY',
      active_delivery: { id: 'd1', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan' },
    });
    let calls = 0;
    const api = renderOrders([o], (c) => {
      if (c.method === 'GET' && c.path === `/admin/orders/${o.id}`) return ok({ order: detailOf(o, []) });
      if (c.method === 'PATCH') {
        calls += 1;
        return calls === 1
          ? fail(422, 'WRONG_DELIVERY_CODE', 'That delivery code is not right. 4 tries left.')
          : ok({ order: o });
      }
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    await user.click(within(panel).getByRole('button', { name: 'Mark delivered' }));
    let dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    await user.type(within(dialog).getByLabelText(/Customer's delivery code/), '1111');
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    expect(await screen.findByText('That delivery code is not right. 4 tries left.')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Mark delivered' }));
    dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    // A half-typed code blocks the submit.
    await user.type(within(dialog).getByLabelText(/Customer's delivery code/), '12');
    expect(within(dialog).getByRole('button', { name: 'Mark delivered' })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Customer's delivery code/));
    await user.type(within(dialog).getByLabelText(/Note/), 'Customer phone dead; paid cash at the gate');
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() =>
      expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[1]?.body).toEqual({
        status: 'DELIVERED',
        notes: 'Customer phone dead; paid cash at the gate',
      })
    );
  });

  it('the row offers Pack when the substitution has its cost (uncosted_substitutions is 0)', async () => {
    const o = boardOrder({
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 1, uncosted_substitutions: 0 },
    });
    renderOrders([o]);
    expect(await screen.findByRole('button', { name: /^Pack #/ })).toBeEnabled();
    expect(screen.queryByText('Substitution needs a cost')).not.toBeInTheDocument();
  });

  it('a substitution without a cost blocks Pack on the row and in the panel', async () => {
    const user = userEvent.setup();
    const o = boardOrder({
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 1, uncosted_substitutions: 1 },
    });
    const items = [
      { id: 'i1', product_name_snapshot: 'Milk', quantity: 1, item_status: 'PENDING', actual_unit_cost: null },
      { id: 'i2', product_name_snapshot: 'Butter (substitute)', quantity: 1, item_status: 'SUBSTITUTED', actual_unit_cost: null },
    ];
    renderOrders([o], (c) => (c.method === 'GET' && c.path === `/admin/orders/${o.id}` ? ok({ order: detailOf(o, items) }) : undefined));
    expect(await screen.findByText('Substitution needs a cost')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pack #/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    await screen.findByText('Butter (substitute)');
    expect(within(panel).getByRole('button', { name: 'Pack' })).toBeDisabled();
  });

  it('Pack is allowed from the panel when the loaded items show every substitution has its cost', async () => {
    const user = userEvent.setup();
    // The board's read is older (the cost was recorded since); the panel's items are fresher.
    const o = boardOrder({
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 1, uncosted_substitutions: 1 },
    });
    const items = [
      { id: 'i1', product_name_snapshot: 'Milk', quantity: 1, item_status: 'PENDING', actual_unit_cost: null },
      { id: 'i2', product_name_snapshot: 'Butter (substitute)', quantity: 1, item_status: 'SUBSTITUTED', actual_unit_cost: '690.00' },
    ];
    const api = renderOrders([o], (c) => {
      if (c.method === 'GET' && c.path === `/admin/orders/${o.id}`) return ok({ order: detailOf(o, items) });
      if (c.method === 'PATCH') return ok({ order: o });
      return undefined;
    });
    expect(await screen.findByText('Substitution needs a cost')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    await screen.findByText('Butter (substitute)');
    const pack = within(panel).getByRole('button', { name: 'Pack' });
    expect(pack).toBeEnabled();
    await user.click(pack);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'PACKED' }));
  });

  it('isPackableFromItems mirrors the backend packing blockers', () => {
    expect(isPackableFromItems([{ item_status: 'SUBSTITUTED', actual_unit_cost: null }, { item_status: 'PENDING', actual_unit_cost: null }])).toBe(false);
    expect(isPackableFromItems([{ item_status: 'SUBSTITUTED', actual_unit_cost: 12 }])).toBe(true);
    expect(isPackableFromItems([{ item_status: 'UNAVAILABLE', actual_unit_cost: null }])).toBe(false);
    // No cost field at all: unknown, the caller keeps the summary rule.
    expect(isPackableFromItems([{ item_status: 'SUBSTITUTED' }])).toBeNull();
    expect(canMarkItemUnavailable('PLACED', 'PENDING', 'ADMIN')).toBe(true);
    expect(canMarkItemUnavailable('PACKED', 'PENDING', 'ADMIN')).toBe(false);
    expect(canMarkItemUnavailable('ITEM_UNAVAILABLE', 'SOURCED', 'ADMIN')).toBe(false);
  });
});

describe('lists that used to cap silently', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('live orders: every page is read in turn, so nothing is hidden; Done today uses the totals', async () => {
    const all = Array.from({ length: 150 }, () => boardOrder());
    const api = renderApp('/orders', (c) => {
      if (c.path !== '/admin/orders') return undefined;
      const status = c.query.get('status');
      if (status === 'DELIVERED') return page([boardOrder({ order_status: 'DELIVERED' })], 137);
      if (status === 'CANCELLED') return page([], 4);
      const n = Number(c.query.get('page') ?? '1');
      return ok({ orders: all.slice((n - 1) * 100, n * 100), pagination: { page: n, limit: 100, total: 150, total_pages: 2 } });
    });
    expect(await screen.findByText('137 delivered · 4 cancelled')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Open order/ })).toHaveLength(150));
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
    const livePages = api.calls
      .filter((c) => c.path === '/admin/orders' && c.query.get('status')?.includes('PLACED'))
      .map((c) => [c.query.get('page'), c.query.get('limit')]);
    expect(livePages).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });

  it('live orders: stops at the page bound and says how many were not loaded', async () => {
    const api = renderApp('/orders', (c) => {
      if (c.path !== '/admin/orders') return undefined;
      const status = c.query.get('status');
      if (status === 'DELIVERED' || status === 'CANCELLED') return page([], 0);
      const n = Number(c.query.get('page') ?? '1');
      const orders = Array.from({ length: 100 }, (_, i) => boardOrder({ id: `o-${n}-${i}` }));
      return ok({ orders, pagination: { page: n, limit: 100, total: 2500, total_pages: 25 } });
    });
    expect(
      await screen.findByText(/Showing 2000 of 2500 live orders — the board loads at most 2,000/, undefined, { timeout: 20_000 })
    ).toBeInTheDocument();
    const livePages = api.calls.filter((c) => c.path === '/admin/orders' && c.query.get('status')?.includes('PLACED'));
    expect(livePages).toHaveLength(20);
  }, 30_000);

  it('products: every page is read, not just the first 200', async () => {
    const product = (i: number) => ({ id: `p${i}`, name: `Product ${i}`, is_active: i % 2 === 0, is_available: true });
    const pages: Record<string, unknown[]> = {
      '1': Array.from({ length: 200 }, (_, i) => product(i)),
      '2': Array.from({ length: 30 }, (_, i) => product(200 + i)),
    };
    const api = mockApi((c) => (c.path === '/admin/products' ? ok({ products: pages[c.query.get('page') ?? '1'] ?? [] }) : undefined));
    tokenStore.save('access', 'refresh');
    const result = await productsApi.listAllAdmin({ is_active: true });
    expect(result.products).toHaveLength(230);
    expect(result.complete).toBe(true);
    expect(api.calls.map((c) => [c.query.get('page'), c.query.get('limit'), c.query.get('is_active')])).toEqual([
      ['1', '200', 'true'],
      ['2', '200', 'true'],
    ]);
  });

  it('the dashboard counts the whole catalog', async () => {
    const product = (i: number) => ({ id: `p${i}`, name: `Product ${i}`, is_active: true, is_available: true });
    renderApp('/', (c) => {
      if (c.path === '/admin/products') {
        const n = c.query.get('page') === '1' ? 200 : c.query.get('page') === '2' ? 5 : 0;
        return ok({ products: Array.from({ length: n }, (_, i) => product(i)) });
      }
      if (c.path === '/admin/categories') return ok({ categories: [] });
      if (c.path === '/admin/promotions') return ok({ promotions: [] });
      return undefined;
    });
    const figure = await screen.findByRole('link', { name: /Live products/ });
    expect(figure).toHaveTextContent('205');
  });
});

// ------------------------------------------------------------- 9. cash
describe('cash hand-ins for inactive riders', () => {
  const RIDERS = [
    { id: 'r1', full_name: 'Kamal', phone: '+94770000001', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'X', open_deliveries: 0, is_active: true },
    // A disabled rider with no staff account: only include_inactive lists them.
    { id: 'r2', full_name: 'Old Rider', phone: '+94770000002', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'Y', open_deliveries: 0, is_active: false },
  ];

  it('handinRiders lists active riders first, then inactive ones marked "(inactive)"', () => {
    expect(handinRiders([RIDERS[1], RIDERS[0]], { id: 'r9', name: 'Gone' })).toEqual([
      { id: 'r1', label: 'Kamal', inactive: false },
      { id: 'r9', label: 'Gone (inactive)', inactive: true },
      { id: 'r2', label: 'Old Rider (inactive)', inactive: true },
    ]);
    // Rows without the flag (an older API) count as active.
    const { is_active: _flag, ...plain } = RIDERS[0];
    expect(handinRiders([plain])).toEqual([{ id: 'r1', label: 'Kamal', inactive: false }]);
  });

  it('the hand-in dialog offers an inactive rider and records for them', async () => {
    const user = userEvent.setup();
    const api = renderApp('/cash', (c) => {
      if (c.path === '/admin/cash/reconciliation')
        return ok({ date: '2026-10-06', timezone: 'Asia/Colombo', riders: [], totals: { collected: 0, handed_in: 0, difference: 0, status: 'BALANCED' } });
      if (c.method === 'GET' && c.path === '/admin/cash/handins') return ok({ handins: [] });
      if (c.path === '/admin/riders') return ok({ riders: c.query.get('include_inactive') === 'true' ? RIDERS : [RIDERS[0]] });
      if (c.method === 'POST' && c.path === '/admin/cash/handins')
        return ok({ handin: { id: 'h1', rider_id: 'r2', rider_name: 'Old Rider', amount: 1500, handin_date: '2026-10-06', note: null } });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Record hand-in' }));
    const dialog = screen.getByRole('dialog', { name: 'Record hand-in' });
    const select = within(dialog).getByRole('combobox');
    await within(dialog).findByRole('option', { name: 'Old Rider (inactive)' });
    await user.selectOptions(select, 'r2');
    await user.type(within(dialog).getByLabelText(/Amount/), '1500');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(api.find('POST', '/admin/cash/handins')[0]?.body).toMatchObject({ rider_id: 'r2', amount: 1500 }));
    expect(api.find('GET', '/admin/riders')[0]?.query.get('include_inactive')).toBe('true');
    // The staff list is no longer needed to find inactive riders.
    expect(api.find('GET', '/admin/staff')).toHaveLength(0);
  });
});

// ------------------------------------------------------------ 10. coupons
function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    code: 'WELCOME50',
    description: null,
    discount_type: 'FIXED',
    discount_value: 50,
    max_discount: null,
    min_subtotal: null,
    first_order_only: false,
    starts_at: null,
    ends_at: null,
    usage_limit: 100,
    per_customer_limit: 1,
    is_active: true,
    usage_count: 12,
    created_at: '2026-09-29T04:30:00.000Z',
    ...overrides,
  };
}

describe('coupon usage limits', () => {
  it('validateForm refuses a total-uses limit below the current usage', () => {
    const form = { ...emptyForm(), code: 'SAVE10', discount_value: '10', usage_limit: '5' };
    expect(validateForm(form, false, 12).usage_limit).toBe('Already used 12 times; the limit cannot be lower than that.');
    expect(validateForm({ ...form, usage_limit: '12' }, false, 12).usage_limit).toBeUndefined();
    expect(validateForm(form, true).usage_limit).toBeUndefined();
  });

  it('the edit dialog stops a limit below usage before sending it', async () => {
    const user = userEvent.setup();
    const api = renderApp('/coupons', (c) => (c.path === '/admin/coupons' ? ok({ coupons: [coupon()] }) : undefined));
    await user.click(await screen.findByRole('button', { name: 'Edit WELCOME50' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit WELCOME50' });
    const limit = within(dialog).getByLabelText(/^Total uses/);
    await user.clear(limit);
    await user.type(limit, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Already used 12 times; the limit cannot be lower than that.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/coupons/c1')).toHaveLength(0);
  });

  it('explains COUPON_IN_USE when a delete races a first use', async () => {
    const user = userEvent.setup();
    let used = false;
    renderApp('/coupons', (c) => {
      if (c.method === 'DELETE') {
        used = true;
        return fail(409, 'COUPON_IN_USE', 'This coupon has been used on orders; switch it off instead.');
      }
      if (c.path === '/admin/coupons') return ok({ coupons: [coupon({ usage_count: used ? 1 : 0 })] });
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Delete WELCOME50' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete coupon' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/WELCOME50 has already been used on orders, so it cannot be deleted\. Switch it off instead/)).toBeInTheDocument();
    // Re-read: the coupon now shows its use and no Delete button.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete WELCOME50' })).toBeNull());
  });
});
