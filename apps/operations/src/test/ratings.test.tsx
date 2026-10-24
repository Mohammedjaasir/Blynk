import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { OrderDetail, RiderEarningsReport } from '../api/types';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * More -> Ratings, the rating + rider tip on the order screen, and the Tips figure in rider
 * earnings (plan 2026-10-24-groups-ratings-requests.md §B) against a fake API shaped like the
 * contract.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const SUMMARY = {
  days: 30,
  average: 4.2,
  count: 10,
  per_star: { 1: 1, 2: 1, 3: 0, 4: 3, 5: 5 },
  top_tags: [
    { tag: 'ON_TIME', count: 6 },
    { tag: 'LATE', count: 2 },
  ],
  per_rider: [{ rider_id: 'r1', rider_name: 'Farhan Mohamed', average: 4.6, count: 7 }],
};

const RATINGS = [
  {
    order_id: 'o7',
    order_number: 'BL-20261023-0007',
    stars: 2,
    tags: ['LATE', 'DAMAGED'],
    comment: 'Eggs were broken',
    created_at: '2026-10-23T10:00:00.000Z',
    customer_name: 'Ahmed Rizvi',
    rider_id: 'r1',
    rider_name: 'Farhan Mohamed',
  },
  {
    order_id: 'o8',
    order_number: 'BL-20261023-0008',
    stars: 5,
    tags: ['ON_TIME', 'FRIENDLY_RIDER'],
    comment: null,
    created_at: '2026-10-23T09:00:00.000Z',
    customer_name: 'Nimali Perera',
    rider_id: 'r2',
    rider_name: 'Kasun Silva',
  },
];

const listRatings = (call: Call) =>
  ok({
    ratings: RATINGS.filter(
      (r) => (!call.query.stars_max || r.stars <= Number(call.query.stars_max)) && (!call.query.rider_id || r.rider_id === call.query.rider_id)
    ),
  });

describe('More -> Ratings', () => {
  it('shows the 30-day summary and the newest ratings with links to their orders', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/ratings/summary': () => ok(SUMMARY),
      'GET /admin/ratings': listRatings,
    });
    await user.click(await screen.findByRole('link', { name: 'Ratings' }));
    expect(await screen.findByTestId('ratings-average')).toHaveTextContent('4.2');
    expect(screen.getByTestId('ratings-count')).toHaveTextContent('10 ratings');
    expect(screen.getByRole('listitem', { name: '5 stars: 5' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Most picked tags' })).getByText('On time · 6')).toBeInTheDocument();
    expect(api.find('GET', '/admin/ratings/summary')[0].query).toEqual({ days: '30' });

    const low = await screen.findByRole('listitem', { name: '2 stars on order #BL-20261023-0007' });
    expect(within(low).getByText('Late')).toBeInTheDocument();
    expect(within(low).getByText('“Eggs were broken”')).toBeInTheDocument();
    expect(within(low).getByRole('link', { name: '#BL-20261023-0007' })).toHaveAttribute('href', '/orders/o7');
    expect(screen.getByRole('listitem', { name: '5 stars on order #BL-20261023-0008' })).toBeInTheDocument();
  });

  it('filters to low ratings and to one rider', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/ratings', {
      'GET /admin/ratings/summary': () => ok(SUMMARY),
      'GET /admin/ratings': listRatings,
    });
    await screen.findByRole('listitem', { name: /5 stars on order/ });
    await user.click(screen.getByRole('button', { name: 'Low (2 stars or less)' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /5 stars on order/ })).toBeNull());
    expect(api.find('GET', '/admin/ratings').at(-1)?.query).toEqual({ stars_max: '2' });
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Show ratings for Farhan Mohamed' }));
    await waitFor(() => expect(api.find('GET', '/admin/ratings').at(-1)?.query).toEqual({ rider_id: 'r1' }));
    expect(await screen.findByText('Rider: Farhan Mohamed')).toBeInTheDocument();
  });

  it('says the migration is missing instead of failing', async () => {
    renderAs(OPERATIONS_STAFF, '/more/ratings', {
      'GET /admin/ratings/summary': () => fail(503, 'RATINGS_NOT_READY'),
      'GET /admin/ratings': () => fail(503, 'RATINGS_NOT_READY'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ratings need database update 055');
  });
});

describe('Order screen: rating and rider tip', () => {
  const detail = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
    id: 'o7',
    order_number: 'BL-20261023-0007',
    order_status: 'DELIVERED',
    payment_method: 'COD',
    payment_status: 'PAID',
    total_amount: 1200,
    placed_at: '2026-10-23T08:00:00.000Z',
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Eggs 10 pack', quantity: 1, item_status: 'PACKED' }],
    history: [],
    delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'DELIVERED', rider_name: 'Farhan Mohamed' },
    ...overrides,
  });

  it('shows the rating sent with the order and the tip', async () => {
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o7', {
      'GET /admin/orders/:id': () =>
        ok({ order: detail({ rider_tip: '100.00', rating: { stars: 2, tags: ['LATE'], comment: 'Eggs were broken', created_at: '2026-10-23T10:00:00.000Z' } }) }),
    });
    expect(await screen.findByTestId('order-rating-stars')).toHaveAccessibleName('2 out of 5 stars');
    const section = screen.getByRole('region', { name: 'Rating and tip' });
    expect(within(section).getByText('Late')).toBeInTheDocument();
    expect(within(section).getByText('“Eggs were broken”')).toBeInTheDocument();
    expect(screen.getByTestId('order-rider-tip')).toHaveTextContent('Rider tip LKR 100');
    // Sent with the order: no second lookup.
    expect(api.find('GET', '/admin/ratings')).toHaveLength(0);
  });

  it('looks the rating up for a delivered order when the order does not carry it', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o7', {
      'GET /admin/orders/:id': () => ok({ order: detail() }),
      // An API that ignores order_id: only this order's row is shown.
      'GET /admin/ratings': () => ok({ ratings: [RATINGS[1], RATINGS[0]] }),
    });
    expect(await screen.findByTestId('order-rating-stars')).toHaveAccessibleName('2 out of 5 stars');
    expect(screen.queryByTestId('order-rider-tip')).toBeNull();
  });
});

describe('Rider earnings: Tips', () => {
  const figures = {
    deliveries: 4,
    delivery_charges: 800,
    customer_delivery_fees: 600,
    rider_share: 400,
    blynk_delivery_share: 400,
    cash_collected: 5000,
    cash_kept: 0,
    cash_to_hand_in: 5000,
    product_sales: 4200,
    product_cost: 3600,
    product_margin: 600,
    coupon_discount: 0,
  };
  const report = (tips?: number): RiderEarningsReport => ({
    range: { from: '2026-10-24', to: '2026-10-24', timezone: 'Asia/Colombo' },
    default_percent: 50,
    riders: [
      {
        ...figures,
        ...(tips !== undefined ? { tips } : {}),
        rider_id: 'r1',
        rider_name: 'Farhan Mohamed',
        rider_phone: '+94779876543',
        pay_type: 'COMMISSION',
        commission_percent: null,
        effective_percent: 50,
      },
    ],
    totals: { ...figures, ...(tips !== undefined ? { tips } : {}) },
  });

  it('shows the Tips figure per rider and in the totals when the API sends it', async () => {
    renderAs(OPERATIONS_STAFF, '/more/earnings', { 'GET /admin/reports/rider-earnings': () => ok(report(150)) });
    expect(await screen.findByTestId('earnings-tips-total')).toHaveTextContent('LKR 150');
    const card = screen.getByRole('listitem', { name: 'Farhan Mohamed' });
    expect(within(card).getByText('Tips')).toBeInTheDocument();
  });

  it('shows no Tips line from an API without tips', async () => {
    renderAs(OPERATIONS_STAFF, '/more/earnings', { 'GET /admin/reports/rider-earnings': () => ok(report()) });
    await screen.findByRole('listitem', { name: 'Farhan Mohamed' });
    expect(screen.queryByText('Tips')).toBeNull();
  });
});
