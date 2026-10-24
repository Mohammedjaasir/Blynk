import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok } from './mockApi';
import { insights, product, renderApp, seller, signInStoredSession, worldHandler } from './fixtures';
import { stockLine, trendOf } from '../lib/requests';

beforeEach(() => signInStoredSession());

const PRODUCTS = [
  product({ id: 'p1', name: 'Kithul Treacle' }),
  product({ id: 'p2', name: 'Mango Jam' }),
  product({ id: 'p3', name: 'Jaggery' }),
];

describe('best sellers on the home screen', () => {
  it('ranks the top products with a trend against last week, stock left and Restock soon', async () => {
    const api = mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) => (call.path === '/seller/insights' ? ok(insights()) : undefined),
      })
    );
    renderApp('/products');

    // The first screen of the file also pays for loading the app: give it longer.
    const section = (
      await screen.findByRole('heading', { name: 'Best sellers this week' }, { timeout: 15_000 })
    ).closest('section')!;
    const box = within(section);
    expect(await box.findByTestId('best-units')).toHaveTextContent('31');
    expect(api.find('GET', '/seller/insights')[0]!.query.get('days')).toBe('7');
    expect(box.getByText('LKR 11,800.00')).toBeInTheDocument();
    expect(box.getByText('18 Oct – 24 Oct')).toBeInTheDocument();

    const rows = within(box.getByRole('list', { name: /best sellers this week/i })).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Kithul Treacle', 'Mango Jam', 'Jaggery']);

    const first = within(rows[0]!);
    expect(first.getByText('18')).toBeInTheDocument();
    expect(first.getByText(/up 50% on last week/i)).toBeInTheDocument();
    expect(first.getByText('6 left · about 2 days')).toBeInTheDocument();
    expect(first.getByText('Restock soon')).toBeInTheDocument();

    const second = within(rows[1]!);
    expect(second.getByText(/down 25% on last week/i)).toBeInTheDocument();
    expect(second.queryByText('Restock soon')).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText(/new - no sales last week/i)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Stock not counted')).toBeInTheDocument();
    // Overall: 31 vs 24 units.
    expect(box.getByText(/up 29% on last week/i)).toBeInTheDocument();
  });

  it('switches to 30 days', async () => {
    const api = mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) =>
          call.path === '/seller/insights'
            ? ok(
                call.query.get('days') === '30'
                  ? insights({ totals: { units: 120, gross: 40000, units_prev: 100 }, period: { from: '2026-09-25', to: '2026-10-24' } })
                  : insights()
              )
            : undefined,
      })
    );
    renderApp('/products');
    await screen.findByRole('heading', { name: 'Best sellers this week' });
    const thirty = screen.getByRole('button', { name: '30 days' });
    await userEvent.click(thirty);
    expect(await screen.findByRole('heading', { name: 'Best sellers, last 30 days' })).toBeInTheDocument();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    expect(api.find('GET', '/seller/insights').at(-1)!.query.get('days')).toBe('30');
    expect(screen.getByText(/up 20% on the 30 days before/i)).toBeInTheDocument();
  });

  it('is left out quietly while the server is not ready (503 SELLER_REQUESTS_NOT_READY)', async () => {
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) =>
          call.path === '/seller/insights' ? fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.') : undefined,
      })
    );
    renderApp('/products');
    expect(await screen.findByRole('article', { name: 'Kithul Treacle' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: /my products/i });
    expect(screen.queryByText(/best sellers/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not shown, or asked for, before the shop is approved', async () => {
    const api = mockApi(worldHandler({ seller: seller({ status: 'PENDING' }), products: PRODUCTS }));
    renderApp('/products');
    await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(screen.queryByText(/best sellers/i)).not.toBeInTheDocument();
    expect(api.find('GET', '/seller/insights')).toHaveLength(0);
  });

  it('says so when nothing sold this week', async () => {
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) =>
          call.path === '/seller/insights' ? ok(insights({ top: [], totals: { units: 0, gross: 0, units_prev: 3 } })) : undefined,
      })
    );
    renderApp('/products');
    expect(await screen.findByText('No sales yet this week')).toBeInTheDocument();
  });

  it('shows a retry when the best sellers cannot load', async () => {
    let first = true;
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) => {
          if (call.path !== '/seller/insights') return undefined;
          if (first) {
            first = false;
            return fail(500, 'INTERNAL', 'Best sellers are not available.');
          }
          return ok(insights());
        },
      })
    );
    renderApp('/products');
    expect(await screen.findByRole('alert')).toHaveTextContent(/best sellers are not available/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('best-units')).toHaveTextContent('31');
  });

  it('"Bring more" on a Restock soon product opens the send-stock note for it', async () => {
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) => {
          if (call.path === '/seller/insights') return ok(insights());
          if (call.method === 'GET' && call.path === '/seller/stock-notes') return ok({ notes: [] });
          return undefined;
        },
      })
    );
    renderApp('/products');
    const section = (await screen.findByRole('heading', { name: 'Best sellers this week' })).closest('section')!;
    // Only the restock product offers it in the list.
    const more = await within(section).findByRole('button', { name: 'Bring more Kithul Treacle' });
    expect(within(section).queryByRole('button', { name: 'Bring more Mango Jam' })).not.toBeInTheDocument();
    await userEvent.click(more);
    expect(await screen.findByRole('dialog', { name: 'Bring more Kithul Treacle' })).toBeInTheDocument();
  });
});

describe('best seller helpers', () => {
  it('words the trend', () => {
    expect(trendOf(18, 12)).toEqual({ kind: 'up', label: '+50%' });
    expect(trendOf(9, 12)).toEqual({ kind: 'down', label: '-25%' });
    expect(trendOf(5, 0)).toEqual({ kind: 'new', label: 'New' });
    expect(trendOf(4, 4)).toEqual({ kind: 'flat', label: 'Same' });
  });

  it('words the stock left', () => {
    const base = insights().top[0]!;
    expect(stockLine({ ...base, stock_on_hand: 6, days_of_stock_left: 1 })).toBe('6 left · about 1 day');
    expect(stockLine({ ...base, stock_on_hand: 2, days_of_stock_left: 0.4 })).toBe('2 left · runs out today');
    expect(stockLine({ ...base, stock_on_hand: 0 })).toBe('Out of stock at Blynk');
    expect(stockLine({ ...base, stock_on_hand: 12, days_of_stock_left: null })).toBe('12 left');
  });
});
