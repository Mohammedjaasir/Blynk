import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { ProductExpirySection } from '../components/ProductExpiry';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Expiry (wave 2, 2026-10-25; migration 059): the Expiry page (buckets, add batch, sold out, discard), the
 * product form's "Track expiry dates" switch, and the dashboard chips - all against a fake API.
 */
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(path: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[path]}>
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

const batch = (over: Record<string, unknown>) => ({
  id: 'b1',
  product_id: 'p1',
  product_name: 'Fresh Milk',
  product_sku: 'MILK-1',
  variant_id: null,
  variant_label: null,
  batch_code: null,
  quantity: 6,
  expires_on: '2026-10-20',
  days_left: -5,
  severity: 'expired',
  label: 'Expired 5 days ago',
  status: 'ACTIVE',
  note: null,
  received_at: '2026-10-10T05:00:00.000Z',
  ...over,
});
const EXPIRED = batch({});
const WEEK = batch({ id: 'b2', product_id: 'p2', product_name: 'Curd', product_sku: 'CURD-1', batch_code: 'C-9', quantity: 12, expires_on: '2026-10-28', days_left: 3, severity: 'red', label: 'Expires in 3 days' });
const SUMMARY = {
  today: '2026-10-25',
  expired: { batches: 1, units: 6 },
  week: { batches: 1, units: 12 },
  month: { batches: 0, units: 0 },
  within_3_days: 1,
  total_active: 2,
};

function expiryHandler(state: { batches: ReturnType<typeof batch>[] }) {
  return (c: Call): Reply | undefined => {
    if (c.method === 'GET' && c.path === '/admin/stock-batches/summary') return ok(SUMMARY);
    if (c.method === 'GET' && c.path === '/admin/stock-batches') {
      const bucket = c.query.get('bucket');
      const rows = state.batches.filter((b) => bucket === 'all' || (bucket === 'expired' ? b.severity === 'expired' : bucket === 'week' ? b.severity === 'red' : false));
      return ok({ today: '2026-10-25', batches: rows, total: rows.length, page: 1, limit: 200 });
    }
    if (c.method === 'POST' && c.path === '/admin/stock-batches') return ok({ batch: batch({ id: 'new', product_id: c.body.product_id, product_name: 'Oat Milk', quantity: c.body.quantity, expires_on: c.body.expires_on }) });
    if (c.method === 'POST' && /\/sold-out$/.test(c.path)) return ok({ batch: { ...EXPIRED, status: 'SOLD_OUT' } });
    if (c.method === 'POST' && /\/discard$/.test(c.path)) return ok({ batch: { ...EXPIRED, status: 'DISCARDED' }, stock_removed: 6, stock: { on_hand: 4, reserved: 0 } });
    if (c.method === 'PATCH' && c.path.startsWith('/admin/stock-batches/')) return ok({ batch: { ...EXPIRED, ...c.body } });
    if (c.method === 'GET' && c.path === '/admin/products') return ok({ products: [{ id: 'p77', name: 'Oat Milk 1L', category_name: 'Dairy', is_active: true }] });
    if (c.method === 'GET' && c.path === '/admin/products/p77/variants') return ok({ variants: [] });
    return undefined;
  };
}

describe('Expiry page', () => {
  it('opens on the most urgent bucket, shows counts, and switches buckets', async () => {
    const user = userEvent.setup();
    const api = renderAt('/expiry', expiryHandler({ batches: [EXPIRED, WEEK] }));
    // expired has something: it opens there
    expect(await screen.findByText('Expired 5 days ago')).toBeInTheDocument();
    expect(api.find('GET', '/admin/stock-batches')[0]!.query.get('bucket')).toBe('expired');
    expect(screen.getByRole('button', { name: /^Expired\s*1$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^This week\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All open\s*2$/ })).toBeInTheDocument();
    expect(screen.queryByText('Curd')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^This week/ }));
    expect(await screen.findByText('Expires in 3 days')).toBeInTheDocument();
    expect(screen.getByText('Curd')).toBeInTheDocument();
    expect(screen.getByText('C-9')).toBeInTheDocument();
    expect(screen.getByText('28 Oct 2026')).toBeInTheDocument();
  });

  it('adds a batch: product picked, quantity and date checked, then saved', async () => {
    const user = userEvent.setup();
    const api = renderAt('/expiry', expiryHandler({ batches: [EXPIRED] }));
    await screen.findByText('Expired 5 days ago');
    await user.click(screen.getByRole('button', { name: 'Add batch' }));
    const dialog = screen.getByRole('dialog', { name: 'Add batch' });
    // nothing chosen yet
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the product first.');

    await user.type(within(dialog).getByLabelText('Search products'), 'oat');
    await user.click(await within(dialog).findByRole('button', { name: /Oat Milk 1L/ }));
    await waitFor(() => expect(api.find('GET', '/admin/products/p77/variants')).toHaveLength(1));
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter how many units');

    await user.type(within(dialog).getByLabelText('How many'), '24');
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick the expiry date.');

    fireEvent.change(within(dialog).getByLabelText('Expiry date'), { target: { value: '2026-12-31' } });
    await user.type(within(dialog).getByLabelText(/^Batch code/), 'OM-5');
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches')).toHaveLength(1));
    expect(api.find('POST', '/admin/stock-batches')[0]!.body).toEqual({
      product_id: 'p77',
      variant_id: null,
      quantity: 24,
      expires_on: '2026-12-31',
      batch_code: 'OM-5',
      note: null,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add batch' })).not.toBeInTheDocument());
    expect(await screen.findByText('Batch of Oat Milk 1L added.')).toBeInTheDocument();
  });

  it('marks a batch sold out only after confirming', async () => {
    const user = userEvent.setup();
    const api = renderAt('/expiry', expiryHandler({ batches: [EXPIRED] }));
    await user.click(await screen.findByRole('button', { name: 'Mark Fresh Milk sold out' }));
    const confirm = screen.getByRole('dialog', { name: 'Mark as sold out?' });
    expect(api.find('POST', '/admin/stock-batches/b1/sold-out')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(api.find('POST', '/admin/stock-batches/b1/sold-out')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Mark Fresh Milk sold out' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Mark as sold out?' })).getByRole('button', { name: 'Mark sold out' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches/b1/sold-out')).toHaveLength(1));
    expect(await screen.findByText('Fresh Milk marked sold out.')).toBeInTheDocument();
  });

  it('discards with a reason and the stock switch, and says what came off stock', async () => {
    const user = userEvent.setup();
    const api = renderAt('/expiry', expiryHandler({ batches: [EXPIRED] }));
    await user.click(await screen.findByRole('button', { name: 'Discard Fresh Milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard batch' });
    expect(dialog).toHaveTextContent('6 units');
    expect(within(dialog).getByRole('radio', { name: 'Expired' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('radio', { name: /Waste/ }));
    await user.click(within(dialog).getByRole('switch', { name: 'Take it off the stock count' }));
    expect(dialog).toHaveTextContent('Only the batch is closed');
    await user.click(within(dialog).getByRole('switch', { name: 'Take it off the stock count' }));
    await user.click(within(dialog).getByRole('button', { name: 'Discard batch' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches/b1/discard')).toHaveLength(1));
    expect(api.find('POST', '/admin/stock-batches/b1/discard')[0]!.body).toEqual({ reason: 'WASTE', reduce_stock: true });
    expect(await screen.findByText('Fresh Milk discarded. 6 units taken off the stock count.')).toBeInTheDocument();
  });

  it('edits a batch', async () => {
    const user = userEvent.setup();
    const api = renderAt('/expiry', expiryHandler({ batches: [EXPIRED] }));
    await user.click(await screen.findByRole('button', { name: 'Edit Fresh Milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit batch' });
    const qty = within(dialog).getByLabelText('How many');
    await user.clear(qty);
    await user.type(qty, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Save batch' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/stock-batches/b1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/stock-batches/b1')[0]!.body).toMatchObject({ quantity: 4, expires_on: '2026-10-20' });
  });

  it('before migration 059 it says which migration to run', async () => {
    renderAt('/expiry', (c) =>
      c.path.startsWith('/admin/stock-batches') ? fail(503, 'EXPIRY_NOT_READY', 'Expiry dates will be available shortly.') : undefined
    );
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('run database migration 059 in Coolify');
  });
});

describe('Dashboard chips and the product form switch', () => {
  it('the dashboard shows expired / this week chips linking to Expiry, and nothing before 059', async () => {
    renderAt('/', (c) => {
      if (c.path === '/admin/stock-batches/summary') return ok(SUMMARY);
      if (c.path === '/admin/products') return ok({ products: [] });
      if (c.path === '/admin/categories') return ok({ categories: [] });
      if (c.path === '/admin/promotions') return ok({ promotions: [] });
      return undefined;
    });
    const chips = await screen.findByRole('region', { name: 'Expiring soon' });
    expect(within(chips).getByRole('link', { name: '1 expired (6 units)' })).toHaveAttribute('href', '/expiry');
    expect(within(chips).getByRole('link', { name: '1 expiring this week (12 units)' })).toBeInTheDocument();
    expect(within(chips).queryByText(/this month/)).not.toBeInTheDocument();
  });

  it('the dashboard shows no chips when the API says 503', async () => {
    renderAt('/', (c) => {
      if (c.path === '/admin/stock-batches/summary') return fail(503, 'EXPIRY_NOT_READY');
      if (c.path === '/admin/products') return ok({ products: [] });
      if (c.path === '/admin/categories') return ok({ categories: [] });
      if (c.path === '/admin/promotions') return ok({ promotions: [] });
      return undefined;
    });
    await screen.findByRole('heading', { name: 'Dashboard' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Expiring soon' })).not.toBeInTheDocument());
  });
});

describe('product form "Track expiry dates"', () => {
  const renderSection = (handler: (c: Call) => Reply | undefined) => {
    tokenStore.save('access', 'refresh');
    const api = mockApi(handler);
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductExpirySection productId="p1" />
        </ToastProvider>
      </MemoryRouter>
    );
    return api;
  };

  it('shows the switch, saves it at once and lists the open batches', async () => {
    const user = userEvent.setup();
    let tracking = false;
    const api = renderSection((c) => {
      if (c.method === 'GET' && c.path === '/admin/stock-batches/product/p1')
        return ok({ product_id: 'p1', product_name: 'Fresh Milk', expiry_tracking: tracking, batches: [WEEK] });
      if (c.method === 'PUT' && c.path === '/admin/stock-batches/product/p1/tracking') {
        tracking = c.body.enabled;
        return ok({ product_id: 'p1', product_name: 'Fresh Milk', expiry_tracking: tracking, batches: [WEEK] });
      }
      return undefined;
    });
    const sw = await screen.findByRole('switch', { name: 'Track expiry dates' });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(within(screen.getByRole('list', { name: 'Open batches' })).getByText(/12 x Curd \(C-9\)/)).toBeInTheDocument();
    await user.click(sw);
    await waitFor(() => expect(api.find('PUT', '/admin/stock-batches/product/p1/tracking')[0]?.body).toEqual({ enabled: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Track expiry dates' })).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText('Expiry dates are tracked for this product.')).toBeInTheDocument();
  });

  it('shows nothing before migration 059', async () => {
    renderSection(() => fail(503, 'EXPIRY_NOT_READY'));
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Track expiry dates' })).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Expiry dates' })).not.toBeInTheDocument();
  });
});
