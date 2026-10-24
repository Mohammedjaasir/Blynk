import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { normalizeRatingsSummary } from '../api/engagement';
import { barPercent } from '../lib/engagement';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/** Ratings + rider tips (2026-10-24 plan, section B): the staff page and the order detail. */
// Many clicks and typing on a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
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

const SUMMARY = {
  average: 4.25,
  count: 8,
  per_star: { 1: 1, 2: 0, 3: 1, 4: 2, 5: 4 },
  top_tags: [
    { tag: 'ON_TIME', count: 5 },
    { tag: 'FRESH', count: 3 },
  ],
  per_rider: [
    { rider_id: 'r1', rider_name: 'Farhan Mohamed', average: 4.5, count: 6 },
    { rider_id: 'r2', rider_name: 'Kasun Silva', average: 3.5, count: 2 },
  ],
};

const RATINGS = [
  {
    order_id: 'o1',
    order_number: 'BL-20261024-0042',
    // Shaped like backend ratings.service presentStaffRating.
    customer: { id: 'u1', name: 'Ahmed Rizvi', phone: '+94771234567' },
    rider: { id: 'r1', name: 'Farhan Mohamed' },
    stars: 2,
    tags: ['LATE', 'DAMAGED'],
    comment: 'Eggs broken',
    created_at: '2026-10-24T06:00:00.000Z',
  },
  {
    order_id: 'o2',
    order_number: 'BL-20261023-0007',
    customer: { id: 'u2', name: 'Fathima Nuha', phone: null },
    rider: { id: 'r2', name: 'Kasun Silva' },
    stars: 5,
    tags: ['FRIENDLY_RIDER'],
    comment: null,
    created_at: '2026-10-23T06:00:00.000Z',
    rider_tip: 50,
    rider_tip_wallet: 50,
  },
];

function ratingsHandler(c: Call): Reply | undefined {
  if (c.path === '/admin/ratings/summary') return ok({ ...SUMMARY, count: Number(c.query.get('days')) === 7 ? 3 : 8, tips: { cash: 150, wallet: 50, total: 200, orders_tipped: 2 } });
  if (c.path === '/admin/ratings') return ok({ ratings: RATINGS });
  if (c.path === '/admin/riders')
    return ok({
      riders: [
        { id: 'r1', full_name: 'Farhan Mohamed', phone: '+94779876543', vehicle_type: 'BIKE', vehicle_registration_number: 'X', open_deliveries: 0 },
        { id: 'r2', full_name: 'Kasun Silva', phone: '+94779876544', vehicle_type: 'BIKE', vehicle_registration_number: 'Y', open_deliveries: 0 },
      ],
    });
  return undefined;
}

describe('ratings (lib)', () => {
  it('reads the summary from either per-star shape and sizes the bars', () => {
    expect(normalizeRatingsSummary({ average: '4.5', count: 2, stars: [{ stars: 5, count: 1 }, { stars: 4, count: 1 }] }).per_star).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 1,
      5: 1,
    });
    expect(normalizeRatingsSummary({ count: 0 }).average).toBeNull();
    expect(barPercent(2, [4, 2, 1, 0, 1])).toBe(50);
    expect(barPercent(0, [0, 0])).toBe(0);
  });
});

describe('Ratings page', () => {
  it('shows the summary for 30 days and switches to 7', async () => {
    const user = userEvent.setup();
    const api = renderAt('/ratings', ratingsHandler);
    expect(await screen.findByTestId('ratings-average')).toHaveTextContent('4.3');
    expect(screen.getByTestId('ratings-count')).toHaveTextContent('8 ratings in the last 30 days');
    expect(screen.getByTestId('ratings-tips')).toHaveTextContent('Rider tips LKR 200 on 2 orders');
    const bars = screen.getByRole('list', { name: 'Ratings by stars' });
    expect(within(bars).getByLabelText('5 stars: 4')).toBeInTheDocument();
    expect(within(bars).getByLabelText('1 stars: 1')).toBeInTheDocument();
    // The biggest count fills the bar; the others are a share of it.
    const fill = within(bars).getByLabelText('4 stars: 2').querySelector('.star-bars__fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(screen.getByRole('list', { name: 'Top tags' })).toHaveTextContent(/On time\s*5/);
    const riders = screen.getByRole('table', { name: 'Average by rider' });
    expect(riders).toHaveTextContent('Farhan Mohamed4.5 ★6 ratings');
    expect(api.find('GET', '/admin/ratings/summary')[0]!.query.get('days')).toBe('30');

    await user.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(screen.getByTestId('ratings-count')).toHaveTextContent('3 ratings in the last 7 days'));
  });

  it('lists ratings newest first with links to the order, and filters them', async () => {
    const user = userEvent.setup();
    const api = renderAt('/ratings', ratingsHandler);
    const table = await screen.findByRole('table', { name: 'Ratings' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('#0042');
    expect(first).toHaveTextContent('Ahmed Rizvi');
    expect(first).toHaveTextContent('Farhan Mohamed');
    expect(within(first!).getByRole('img', { name: '2 of 5 stars' })).toBeInTheDocument();
    expect(first).toHaveTextContent('Late');
    expect(first).toHaveTextContent('Damaged');
    expect(first).toHaveTextContent('Eggs broken');
    expect(second).toHaveTextContent('Tip LKR 100');
    expect(within(first!).getByRole('link', { name: 'Open order #0042' })).toHaveAttribute('href', '/orders/o1');

    await screen.findByRole('option', { name: 'Kasun Silva' });
    await user.selectOptions(screen.getByLabelText('Stars'), '2');
    await user.selectOptions(screen.getByLabelText('Rider'), 'r1');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-24' } });
    await waitFor(() => {
      const q = api.find('GET', '/admin/ratings').at(-1)!.query;
      expect([q.get('stars_max'), q.get('rider_id'), q.get('from'), q.get('to')]).toEqual(['2', 'r1', '2026-10-01', '2026-10-24']);
    });
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(api.find('GET', '/admin/ratings').at(-1)!.query.toString()).toBe(''));
  });

  it('says to run migration 055 while the server is not ready', async () => {
    renderAt('/ratings', (c) =>
      c.path.startsWith('/admin/ratings') ? fail(503, 'RATINGS_NOT_READY') : c.path === '/admin/riders' ? ok({ riders: [] }) : undefined
    );
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('run database migration 055 in Coolify');
  });
});

describe('Order detail: rating and tip', () => {
  it('opens a rated order from its link and shows the stars, tags, comment and the rider tip', async () => {
    const user = userEvent.setup();
    renderAt('/ratings', (c) => {
      if (c.path === '/admin/orders/o1')
        return ok({
          order: {
            id: 'o1',
            order_number: 'BL-20261024-0042',
            order_status: 'DELIVERED',
            payment_method: 'COD',
            payment_status: 'PAID',
            subtotal_amount: 1200,
            delivery_fee: 150,
            total_amount: 1450,
            rider_tip: '100.00',
            rider_tip_wallet: '0.00',
            placed_at: '2026-10-24T04:00:00.000Z',
            scheduled_for: null,
            delivery_recipient_name: 'Ahmed Rizvi',
            delivery_recipient_phone: '+94771234567',
            delivery_address_line1: '14 Main Street',
            delivery_address_line2: null,
            delivery_city: 'Dharga Town',
            delivery_instructions: null,
            cancellation_reason: null,
            items: [{ id: 'i1', product_name_snapshot: 'Eggs 10', quantity: 1, item_status: 'PACKED' }],
            history: [],
            delivery: { id: 'd1', assignment_status: 'DELIVERED', rider_name: 'Farhan Mohamed' },
            rating: { stars: 2, tags: ['LATE', 'DAMAGED'], comment: 'Eggs broken', created_at: '2026-10-24T06:00:00.000Z' },
          },
        });
      return ratingsHandler(c);
    });
    await user.click(await screen.findByRole('link', { name: 'Open order #0042' }));
    expect(await screen.findByRole('heading', { name: 'Order #0042' })).toBeInTheDocument();
    const rating = await screen.findByTestId('order-rating');
    expect(within(rating).getByRole('img', { name: '2 of 5 stars' })).toBeInTheDocument();
    expect(rating).toHaveTextContent('Late');
    expect(rating).toHaveTextContent('Eggs broken');
    expect(screen.getByTestId('order-tip')).toHaveTextContent('Rider tip LKR 100');
    // Read-only: no board actions.
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('says "Not rated yet" on a delivered order without a rating, and nothing on an older API', async () => {
    const base = {
      id: 'o3',
      order_number: 'BL-20261024-0050',
      order_status: 'DELIVERED',
      payment_method: 'COD',
      payment_status: 'PAID',
      subtotal_amount: 500,
      delivery_fee: 0,
      total_amount: 500,
      placed_at: '2026-10-24T04:00:00.000Z',
      scheduled_for: null,
      delivery_recipient_name: 'Ahmed Rizvi',
      delivery_recipient_phone: '+94771234567',
      delivery_address_line1: '14 Main Street',
      delivery_address_line2: null,
      delivery_city: 'Dharga Town',
      delivery_instructions: null,
      cancellation_reason: null,
      items: [],
      history: [],
      delivery: null,
    };
    renderAt('/orders/o3', (c) => (c.path === '/admin/orders/o3' ? ok({ order: { ...base, rating: null, rider_tip: 0 } }) : undefined));
    expect(await screen.findByText('Not rated yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('order-tip')).toBeNull();
  });
});
