import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { tokenStore } from '../api/client';
import { MemoryRouter } from 'react-router-dom';
import { SellerProvider } from '../auth/SellerContext';
import { CommissionFreeCard } from '../components/CommissionFree';
import { TAGLINE } from '../components/Tagline';
import { mockApi, ok } from './mockApi';
import { ROUTER_FUTURE, renderApp, seller, signInStoredSession, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());
afterEach(() => vi.useRealTimers());

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe('tagline', () => {
  it('is on the sign-in page, under the brand', async () => {
    tokenStore.clear();
    mockApi(() => undefined);
    renderApp('/sign-in');
    const line = await screen.findByTestId('tagline');
    expect(line).toHaveTextContent('Open to sellers in Dharga Town only, for now.');
    expect(TAGLINE).toBe('Open to sellers in Dharga Town only, for now.');
    // Under the brand lockup, in the brand panel.
    expect(line.closest('.signin__brand')).not.toBeNull();
  });

  it('is on the home screen header card', async () => {
    mockApi(worldHandler());
    renderApp('/products');
    const hero = await screen.findByTestId('tagline');
    expect(hero).toHaveTextContent('Open to sellers in Dharga Town only, for now.');
    expect(hero.closest('.hero')).not.toBeNull();
  });
});

describe('commission-free card on the home screen and My shop', () => {
  it('counts down: "Commission-free: 23 days to go" with a progress bar', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: inDays(22.5), commission_free_days_left: 23, commission_free_days: 30 }),
      })
    );
    renderApp('/products');
    const card = await screen.findByTestId('commission-free');
    expect(card).toHaveTextContent('Commission-free: 23 days to go');
    expect(card).toHaveAttribute('data-kind', 'running');
    const bar = within(card).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '7');
    expect(bar).toHaveAttribute('aria-valuemax', '30');
    expect(bar.querySelector('span')).toHaveStyle({ width: '23.3%' });
  });

  it('reads the fields from beside the seller too', async () => {
    mockApi((call) =>
      call.path === '/seller/me'
        ? ok({
            seller: seller(),
            counts: { products: 0, pending: 0 },
            commission_free_until: inDays(9.5),
            commission_free_days_left: 10,
            commission_free_days: 30,
          })
        : worldHandler()(call)
    );
    renderApp('/products');
    expect(await screen.findByTestId('commission-free')).toHaveTextContent('Commission-free: 10 days to go');
  });

  it('is also on My shop', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: inDays(4.5), commission_free_days_left: 5, commission_free_days: 30 }),
      })
    );
    renderApp('/shop');
    expect(await screen.findByTestId('commission-free')).toHaveTextContent('Commission-free: 5 days to go');
  });

  it('says "1 day to go" (singular) when the last day is tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T06:00:00.000Z'));
    mockApi(
      worldHandler({
        seller: seller({
          commission_free_until: '2026-10-31T04:00:00.000Z',
          commission_free_days_left: 1,
          commission_free_days: 30,
        }),
      })
    );
    renderApp('/products');
    const card = await screen.findByTestId('commission-free');
    expect(card).toHaveTextContent('Commission-free: 1 day to go');
    expect(card).toHaveAttribute('data-kind', 'running');
  });

  it('on the last day says "Last commission-free day"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T06:00:00.000Z'));
    mockApi(
      worldHandler({
        seller: seller({
          commission_free_until: '2026-10-30T15:00:00.000Z',
          commission_free_days_left: 1,
          commission_free_days: 30,
        }),
      })
    );
    renderApp('/products');
    const card = await screen.findByTestId('commission-free');
    expect(card).toHaveTextContent('Last commission-free day');
    expect(card).toHaveAttribute('data-kind', 'last-day');
  });

  it('after it ended: "Commission-free month is over. Blynk\'s commission rates apply now."', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: daysAgo(2), commission_free_days_left: 0, commission_free_days: 30 }),
      })
    );
    renderApp('/products');
    const card = await screen.findByTestId('commission-free');
    expect(card).toHaveTextContent("Commission-free month is over. Blynk's commission rates apply now.");
    expect(card).toHaveAttribute('data-kind', 'ended');
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows nothing a week after it ended', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: daysAgo(8), commission_free_days_left: 0, commission_free_days: 30 }),
      })
    );
    renderApp('/products');
    await screen.findByRole('heading', { name: /my products/i });
    expect(screen.queryByTestId('commission-free')).not.toBeInTheDocument();
  });

  it('shows nothing when the shop has no free period (null) or the API does not send it', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: null, commission_free_days_left: null, commission_free_days: 30 }),
      })
    );
    renderApp('/products');
    await screen.findByRole('heading', { name: /my products/i });
    expect(screen.queryByTestId('commission-free')).not.toBeInTheDocument();
  });

  it('renders on its own from the seller in context', async () => {
    mockApi(
      worldHandler({
        seller: seller({ commission_free_until: '2026-11-22T06:00:00.000Z', commission_free_days_left: 23 }),
      })
    );
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <SellerProvider>
          <CommissionFreeCard now={new Date('2026-10-30T06:00:00.000Z')} />
        </SellerProvider>
      </MemoryRouter>
    );
    expect(await screen.findByTestId('commission-free')).toHaveTextContent('23 days to go');
  });
});
