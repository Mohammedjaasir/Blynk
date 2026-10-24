import { cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Bundle offers (owner, 2026-10-25): Catalog -> Bundle offers, "buy 2 get 1" and "spend X, get a gift".
 * The API contract is tested against PostgreSQL in backend/api/tests (bundle offers).
 */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

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

  it('names what is wrong with an offer and previews the words', () => {
    const buy = draftFrom(JUICE);
    expect(bundleProblem(buy)).toBeNull();
    expect(bundleProblem({ ...buy, title: 'A' })).toMatch(/title/);
    expect(bundleProblem({ ...buy, category_id: null, product_ids: [] })).toMatch(/pick the products/);
    const gift = draftFrom(GIFT);
    expect(bundleProblem({ ...gift, gift_product_id: null })).toMatch(/gift product/);
    expect(bundlePreview(buy).badge).toBe('Buy 2 get 1 free');
    expect(bundlePreview(gift).cart[1]).toBe('Free gift: Biscuit pack');
  });

  it('sends only the fields of the offer type, no id for a new offer', () => {
    const fresh = { ...blankDraft('BUY_X_GET_Y'), title: ' Chips 3+1 ', buy_qty: 3, get_qty: 1, product_ids: ['p-1'], products: [{ id: 'p-1', name: 'Chips' }] };
    expect(bundlesPayload([fresh])).toEqual({
      offers: [{ type: 'BUY_X_GET_Y', title: 'Chips 3+1', is_active: true, starts_at: null, ends_at: null, buy_qty: 3, get_qty: 1, product_ids: ['p-1'], category_id: null, min_subtotal: null, gift_product_id: null, gift_qty: null }],
    });
  });
});

describe('Catalog -> Bundle offers (Blynk Ops)', () => {
  const mocks = (state: { saved: any[] | null }, list: BundleOfferView[] = [JUICE, GIFT]) => ({
    'GET /admin/settings/bundle-offers': () => ok({ ready: true, offers: list, updated_at: null }),
    'PUT /admin/settings/bundle-offers': (call: { body: { offers: any[] } }) => {
      state.saved = call.body.offers;
      return ok({ ready: true, offers: [], updated_at: '2026-10-25T10:00:00Z' });
    },
    'GET /admin/categories': () =>
      ok({
        categories: [
          { id: 'c-snacks', name: 'Snacks', slug: 'snacks', is_active: true, display_order: 1, parent_id: null },
          { id: 'c-juice', name: 'Juices', slug: 'juices', is_active: true, display_order: 2, parent_id: null },
        ],
      }),
    'GET /admin/products': () => ok({ products: [{ id: 'p-3', name: 'Lime soda', sku: 'LS1', unit: '1 L', is_active: true }], pagination: {} }),
    'GET /admin/category-groups': () => ok({ groups: [], ungrouped: [] }),
  });

  it('lists the offers with status chips', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/bundle-offers', mocks({ saved: null }));
    expect(await screen.findByText('Juice buy 2 get 1')).toBeInTheDocument();
    const rows = screen.getAllByTestId('bundle-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Live');
    expect(rows[0]).toHaveTextContent('Buy 2 get 1 free');
    expect(rows[1]).toHaveTextContent('Off');
    expect(rows[1]).toHaveTextContent('Spend LKR 3,000, get a free Biscuit pack');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits an offer, shows the preview and saves the whole list with PUT', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/bundle-offers', mocks(state));
    await screen.findByText('Juice buy 2 get 1');
    await user.click(screen.getByRole('button', { name: 'Edit Juice buy 2 get 1' }));
    expect(screen.getByTestId('preview-badge')).toHaveTextContent('Buy 2 get 1 free');
    // the whole Ops shell re-renders per keystroke: set the values directly
    fireEvent.change(screen.getByLabelText('Buy quantity'), { target: { value: '3' } });
    expect(screen.getByTestId('preview-badge')).toHaveTextContent('Buy 3 get 1 free');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveLength(2));
    expect(state.saved?.[0]).toMatchObject({ id: 'b-juice', buy_qty: 3, get_qty: 1, category_id: 'c-juice', product_ids: null });
    expect(await screen.findByText('Bundle offers saved.')).toBeInTheDocument();
  });

  it('adds a spend-and-get-a-gift offer with the gift product', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/bundle-offers', mocks(state, []));
    await screen.findByText(/No bundle offers yet/);
    await user.click(screen.getByRole('button', { name: /Add a "spend and get a gift" offer/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gift over 5000' } });
    fireEvent.change(screen.getByLabelText('Spend'), { target: { value: '5000' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lime' } });
    await user.click(await screen.findByRole('button', { name: 'Choose Lime soda' }));
    expect(screen.getByTestId('preview-line')).toHaveTextContent('Free gift: Lime soda');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saved).toEqual([
        { type: 'SPEND_GET_GIFT', title: 'Gift over 5000', is_active: true, starts_at: null, ends_at: null, buy_qty: null, get_qty: null, product_ids: null, category_id: null, min_subtotal: 5000, gift_product_id: 'p-3', gift_qty: 1 },
      ])
    );
  });

  it('adds a buy-and-get-free offer for picked products and removes an offer', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/bundle-offers', mocks(state, [GIFT]));
    await screen.findByText('Spend 3000 gift');
    await user.click(screen.getByRole('button', { name: /Add a "buy and get free" offer/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Soda 2+1' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lime' } });
    await user.click(await screen.findByRole('button', { name: 'Choose Lime soda' }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove Spend 3000 gift' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(state.saved?.[0]).toMatchObject({ type: 'BUY_X_GET_Y', title: 'Soda 2+1', buy_qty: 2, get_qty: 1, product_ids: ['p-3'], category_id: null });
  });

  it('the Catalog hub links to it', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog', mocks({ saved: null }));
    const card = await screen.findByRole('link', { name: /Bundle offers/ });
    expect(card).toHaveAttribute('href', '/catalog/bundle-offers');
  });
});
