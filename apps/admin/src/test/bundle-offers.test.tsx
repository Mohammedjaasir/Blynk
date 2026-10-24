import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { BundleOffers } from '../pages/BundleOffers';
import { tokenStore } from '../api/client';
import {
  blankDraft,
  bundleBadgeText,
  bundleOfferSummary,
  bundlePreview,
  bundleProblem,
  bundleProgressText,
  bundleStatus,
  bundlesPayload,
  draftFrom,
  type BundleOfferView,
} from '../lib/bundleOffers';
import { mockApi, ok, type Call } from './mockApi';

/**
 * Bundle offers (owner, 2026-10-25): the page that makes "buy 2 get 1" and "spend X, get a gift" offers.
 * The API contract is tested against PostgreSQL in backend/api/tests (bundle offers).
 */
vi.setConfig({ testTimeout: 20_000 });

const base = { is_active: true, starts_at: null, ends_at: null, buy_qty: null, get_qty: null, product_ids: null, category_id: null, min_subtotal: null, gift_product_id: null, gift_qty: null };
const JUICE: BundleOfferView = {
  ...base,
  id: 'b-juice',
  type: 'BUY_X_GET_Y',
  title: 'Juice buy 2 get 1',
  buy_qty: 2,
  get_qty: 1,
  category_id: 'c-juice',
  status: 'LIVE',
  category_name: 'Juices',
};
const GIFT: BundleOfferView = {
  ...base,
  id: 'b-gift',
  type: 'SPEND_GET_GIFT',
  title: 'Spend 3000 gift',
  min_subtotal: 3000,
  gift_product_id: 'p-biscuit',
  gift_qty: 1,
  gift_product_name: 'Biscuit pack',
  is_active: false,
  status: 'OFF',
};

describe('bundle offer rules (same words as the customer app)', () => {
  it('words the badge and the progress card', () => {
    expect(bundleBadgeText(2, 1)).toBe('Buy 2 get 1 free');
    expect(bundleProgressText({ remainingLkr: 450, giftName: 'Biscuit pack' })).toBe('Add LKR 450 more for a free Biscuit pack');
    expect(bundleProgressText({ remainingUnits: 1, get: 1 })).toBe('Add 1 more to get 1 free');
    expect(bundleOfferSummary(GIFT)).toBe('Spend LKR 3,000, get a free Biscuit pack');
  });

  it('works out the status like the API', () => {
    const at = new Date('2026-10-25T12:00:00+05:30');
    const s = { is_active: true, starts_at: null, ends_at: null };
    expect(bundleStatus(s, at)).toBe('LIVE');
    expect(bundleStatus({ ...s, is_active: false }, at)).toBe('OFF');
    expect(bundleStatus({ ...s, starts_at: '2026-10-25T13:00:00+05:30' }, at)).toBe('SCHEDULED');
    expect(bundleStatus({ ...s, ends_at: '2026-10-25T12:00:00+05:30' }, at)).toBe('ENDED');
  });

  it('names what is wrong with an offer', () => {
    const buy = draftFrom(JUICE);
    expect(bundleProblem(buy)).toBeNull();
    expect(bundleProblem({ ...buy, title: 'A' })).toMatch(/title/);
    expect(bundleProblem({ ...buy, buy_qty: 0 })).toMatch(/buy quantity/);
    expect(bundleProblem({ ...buy, get_qty: null })).toMatch(/free quantity/);
    expect(bundleProblem({ ...buy, category_id: null, product_ids: [] })).toMatch(/pick the products/);
    expect(bundleProblem({ ...buy, starts_at: '2026-10-25T18:00:00+05:30', ends_at: '2026-10-25T09:00:00+05:30' })).toMatch(/after the start/);
    const gift = draftFrom(GIFT);
    expect(bundleProblem(gift)).toBeNull();
    expect(bundleProblem({ ...gift, min_subtotal: null })).toMatch(/spend/);
    expect(bundleProblem({ ...gift, gift_product_id: null })).toMatch(/gift product/);
    expect(bundleProblem({ ...gift, gift_qty: 11 })).toMatch(/gift quantity/);
  });

  it('previews the words customers read', () => {
    expect(bundlePreview(draftFrom(JUICE)).badge).toBe('Buy 2 get 1 free');
    expect(bundlePreview(draftFrom(JUICE)).cart[0]).toBe('Add 1 more to get 1 free');
    const g = bundlePreview(draftFrom(GIFT));
    expect(g.badge).toBeNull();
    expect(g.cart[0]).toMatch(/^Add LKR \d+ more for a free Biscuit pack$/);
    expect(g.cart[1]).toBe('Free gift: Biscuit pack');
  });

  it('sends only the fields of the offer type, no id for a new offer', () => {
    const fresh = { ...blankDraft('BUY_X_GET_Y'), title: ' Chips 3+1 ', buy_qty: 3, get_qty: 1, product_ids: ['p-1'], products: [{ id: 'p-1', name: 'Chips' }] };
    expect(bundlesPayload([draftFrom(GIFT), fresh])).toEqual({
      offers: [
        { id: 'b-gift', type: 'SPEND_GET_GIFT', title: 'Spend 3000 gift', is_active: false, starts_at: null, ends_at: null, buy_qty: null, get_qty: null, product_ids: null, category_id: null, min_subtotal: 3000, gift_product_id: 'p-biscuit', gift_qty: 1 },
        { type: 'BUY_X_GET_Y', title: 'Chips 3+1', is_active: true, starts_at: null, ends_at: null, buy_qty: 3, get_qty: 1, product_ids: ['p-1'], category_id: null, min_subtotal: null, gift_product_id: null, gift_qty: null },
      ],
    });
  });
});

describe('Bundle offers page', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  const handler = (state: { saved: any[] | null }, list: BundleOfferView[] = [JUICE, GIFT]) => (c: Call) => {
    if (c.method === 'GET' && c.path === '/admin/settings/bundle-offers') return ok({ offers: list, updated_at: null });
    if (c.method === 'PUT' && c.path === '/admin/settings/bundle-offers') {
      state.saved = c.body.offers;
      return ok({ offers: [], updated_at: '2026-10-25T10:00:00Z' });
    }
    if (c.method === 'GET' && c.path === '/admin/categories') {
      return ok({
        categories: [
          { id: 'c-snacks', name: 'Snacks', slug: 'snacks', is_active: true, display_order: 1, parent_id: null },
          { id: 'c-juice', name: 'Juices', slug: 'juices', is_active: true, display_order: 2, parent_id: null },
        ],
      });
    }
    if (c.method === 'GET' && c.path === '/admin/products') {
      return ok({ products: [{ id: 'p-3', name: 'Lime soda', category_name: 'Juices', is_active: true }] });
    }
    return undefined;
  };

  const renderPage = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <BundleOffers />
        </ToastProvider>
      </MemoryRouter>
    );

  it('lists the offers with status chips', async () => {
    mockApi(handler({ saved: null }));
    renderPage();
    expect(await screen.findByText('Juice buy 2 get 1')).toBeInTheDocument();
    const rows = screen.getAllByTestId('bundle-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Live');
    expect(rows[0]).toHaveTextContent('Buy 2 get 1 free');
    expect(rows[0]).toHaveTextContent('Juices');
    expect(rows[1]).toHaveTextContent('Off');
    expect(rows[1]).toHaveTextContent('Spend LKR 3,000, get a free Biscuit pack');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits an offer, shows the preview and saves the whole list with PUT', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state));
    renderPage();
    await screen.findByText('Juice buy 2 get 1');
    await user.click(screen.getByRole('button', { name: 'Edit Juice buy 2 get 1' }));
    expect(screen.getByTestId('preview-badge')).toHaveTextContent('Buy 2 get 1 free');
    const buy = screen.getByLabelText('Buy quantity');
    await user.clear(buy);
    await user.type(buy, '3');
    expect(screen.getByTestId('preview-badge')).toHaveTextContent('Buy 3 get 1 free');
    expect(screen.getByTestId('preview-progress')).toHaveTextContent('Add 1 more to get 1 free');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveLength(2));
    expect(state.saved?.[0]).toMatchObject({ id: 'b-juice', type: 'BUY_X_GET_Y', buy_qty: 3, get_qty: 1, category_id: 'c-juice', product_ids: null });
    expect(state.saved?.[1]).toMatchObject({ id: 'b-gift', type: 'SPEND_GET_GIFT', is_active: false, min_subtotal: 3000, gift_product_id: 'p-biscuit' });
  });

  it('adds a buy-and-get-free offer for picked products with a schedule', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state, []));
    renderPage();
    expect(await screen.findByText(/No bundle offers yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add a "buy and get free" offer/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/title/);
    await user.type(screen.getByLabelText('Title'), 'Soda 2+1');
    expect(screen.getByRole('alert')).toHaveTextContent(/pick the products/);
    await user.type(screen.getByLabelText('Search products'), 'lime');
    await user.click(await screen.findByRole('button', { name: /Lime soda/ }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(1);
    await user.type(screen.getByLabelText('Ends'), '2099-10-30T18:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saved).toEqual([
        { type: 'BUY_X_GET_Y', title: 'Soda 2+1', is_active: true, starts_at: null, ends_at: '2099-10-30T18:00:00+05:30', buy_qty: 2, get_qty: 1, product_ids: ['p-3'], category_id: null, min_subtotal: null, gift_product_id: null, gift_qty: null },
      ])
    );
  });

  it('adds a spend-and-get-a-gift offer with the gift product', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state, []));
    renderPage();
    await screen.findByText(/No bundle offers yet/);
    await user.click(screen.getByRole('button', { name: /Add a "spend and get a gift" offer/ }));
    await user.type(screen.getByLabelText('Title'), 'Gift over 5000');
    await user.type(screen.getByLabelText('Spend'), '5000');
    await user.type(screen.getByLabelText('Search products'), 'lime');
    await user.click(await screen.findByRole('button', { name: /Lime soda/ }));
    expect(screen.getByTestId('preview-line')).toHaveTextContent('Free gift: Lime soda');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saved).toEqual([
        { type: 'SPEND_GET_GIFT', title: 'Gift over 5000', is_active: true, starts_at: null, ends_at: null, buy_qty: null, get_qty: null, product_ids: null, category_id: null, min_subtotal: 5000, gift_product_id: 'p-3', gift_qty: 1 },
      ])
    );
  });

  it('removes an offer', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state));
    renderPage();
    await screen.findByText('Juice buy 2 get 1');
    await user.click(screen.getByRole('button', { name: 'Remove Juice buy 2 get 1' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved?.map((s) => s.id)).toEqual(['b-gift']));
  });
});
