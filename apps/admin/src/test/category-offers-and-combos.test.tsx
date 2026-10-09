import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { Categories } from '../pages/Categories';
import { Combos } from '../pages/Combos';
import { OrderItems } from '../components/OrderItems';
import type { Combo, OrderCombo, OrderItemRow } from '../api/types';
import { comboProblems, groupOrderItems, validateCategoryOffer } from '../lib/combos';
import { fail, mockApi, ok } from './mockApi';

/**
 * Category offers and combo packs (owner, 2026-10-09; migration 033). The
 * backend is the authority; the Admin previews, pre-checks and shows its
 * refusals.
 */
const BAKERY = {
  id: 'c1',
  name: 'Bakery',
  slug: 'bakery',
  description: null,
  image_url: null,
  display_order: 0,
  is_active: true,
  parent_id: null,
  offer_percent: null as number | null,
  offer_ends_at: null as string | null,
  offer_active: false,
};
const BREAD_CAT = { ...BAKERY, id: 'c2', name: 'Bread', slug: 'bread', parent_id: 'c1' };
const DAIRY = { ...BAKERY, id: 'c3', name: 'Dairy', slug: 'dairy', offer_percent: 15, offer_ends_at: null, offer_active: true };

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );
}

function renderCategories(
  rows = [BAKERY, BREAD_CAT, DAIRY],
  onOffer: (method: string, body: any) => ReturnType<typeof ok> = (method, body) =>
    ok({ category: { ...BAKERY, ...(method === 'PUT' ? body : { offer_percent: null, offer_ends_at: null }) } })
) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: rows });
    if (c.method === 'GET' && c.path === '/admin/category-groups') return ok({ groups: [], unassigned: [] });
    if (c.path.endsWith('/offer')) return onOffer(c.method, c.body);
    return undefined;
  });
  wrap(<Categories />);
  return api;
}

describe('category offers', () => {
  it('shows "15% off" by a category whose offer is running', async () => {
    renderCategories();
    const dairy = (await screen.findByText('Dairy')).closest('tr')!;
    expect(within(dairy).getByText('15% off')).toBeInTheDocument();
    const bakery = screen.getByText('Bakery').closest('tr')!;
    expect(within(bakery).queryByText(/% off/)).toBeNull();
  });

  it('previews the offer (sub-categories too) and saves % and end of day in Colombo', async () => {
    const user = userEvent.setup();
    const api = renderCategories();
    await user.click(await screen.findByRole('button', { name: 'Offer for Bakery' }));
    const dialog = screen.getByRole('dialog', { name: 'Category offer' });
    await user.type(within(dialog).getByLabelText(/% off/), '10');
    expect(within(dialog).getByText('10% off everything in Bakery')).toBeInTheDocument();
    expect(within(dialog).getByText('Also covers its sub-categories: Bread.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Offer ends/), { target: { value: '2099-12-31' } });
    expect(within(dialog).getByText(/until 31 Dec 2099/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save offer' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Category offer' })).toBeNull());
    expect(api.find('PUT', '/admin/categories/c1/offer')[0]?.body).toEqual({
      offer_percent: 10,
      offer_ends_at: '2099-12-31T23:59:59+05:30',
    });
  });

  it('sends no end date when none is picked', async () => {
    const user = userEvent.setup();
    const api = renderCategories();
    await user.click(await screen.findByRole('button', { name: 'Offer for Bakery' }));
    await user.type(screen.getByLabelText(/% off/), '12.5');
    await user.click(screen.getByRole('button', { name: 'Save offer' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/c1/offer')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/c1/offer')[0]?.body).toEqual({ offer_percent: 12.5, offer_ends_at: null });
  });

  it.each(['100', '0', '12.345', 'abc'])('refuses %s %% without calling the API', async (value) => {
    const user = userEvent.setup();
    const api = renderCategories();
    await user.click(await screen.findByRole('button', { name: 'Offer for Bakery' }));
    await user.type(screen.getByLabelText(/% off/), value);
    await user.click(screen.getByRole('button', { name: 'Save offer' }));
    expect(await screen.findByText('Enter a % above 0 and below 100, with at most 2 decimals')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/categories/c1/offer')).toHaveLength(0);
  });

  it('Remove offer sends DELETE', async () => {
    const user = userEvent.setup();
    const api = renderCategories([BAKERY, DAIRY]);
    await user.click(await screen.findByRole('button', { name: 'Offer for Dairy' }));
    const dialog = screen.getByRole('dialog', { name: 'Category offer' });
    expect(within(dialog).getByLabelText(/% off/)).toHaveValue('15');
    expect(within(dialog).getByText('Running now: 15% off.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove offer' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c3/offer')).toHaveLength(1));
  });

  it('says when a stored offer has ended', async () => {
    const user = userEvent.setup();
    renderCategories([{ ...BAKERY, offer_percent: 20, offer_ends_at: '2020-01-31T18:29:59.000Z', offer_active: false }]);
    await user.click(await screen.findByRole('button', { name: 'Offer for Bakery' }));
    expect(screen.getByText(/Ended on 31 Jan 2020/)).toBeInTheDocument();
  });

  it("shows the API's OFFER_END_IN_PAST by the end field", async () => {
    const user = userEvent.setup();
    renderCategories(undefined, () => fail(400, 'OFFER_END_IN_PAST', 'The offer end date must be in the future.'));
    await user.click(await screen.findByRole('button', { name: 'Offer for Bakery' }));
    await user.type(screen.getByLabelText(/% off/), '10');
    await user.click(screen.getByRole('button', { name: 'Save offer' }));
    expect(await screen.findByText('The offer end date must be in the future.')).toBeInTheDocument();
  });

  it('validateCategoryOffer: a past end day is refused only when changed', () => {
    expect(validateCategoryOffer('10', '2020-01-01', '', '2026-10-09').endsOn).toBe('Pick today or a later day');
    expect(validateCategoryOffer('10', '2020-01-01', '2020-01-01', '2026-10-09').endsOn).toBeUndefined();
    expect(validateCategoryOffer('99.99', '', '')).toEqual({});
  });
});

// ------------------------------------------------------------- combo packs
const item = (over: Partial<Combo['items'][number]>) => ({
  product_id: 'p1',
  name: 'Bread',
  slug: 'bread',
  sku: 'BREAD',
  unit: '1 loaf',
  pack_size: null,
  image_url: null,
  quantity: 1,
  selling_price: 200,
  unit_price: 200,
  is_active: true,
  is_available: true,
  in_stock: true,
  stock_available: null,
  ...over,
});

const BREAKFAST: Combo = {
  id: 'k1',
  name: 'Breakfast pack',
  description: null,
  image_url: null,
  price: 450,
  is_active: true,
  ends_at: null,
  display_order: 0,
  items: [item({}), item({ product_id: 'p2', name: 'Eggs', sku: 'EGGS', quantity: 2, selling_price: 150, unit_price: 150 })],
  items_total: 500,
  saving: 50,
  is_live: true,
  is_available: true,
  not_live_reason: null,
};

const product = (id: string, name: string, price: number, customer?: number) => ({
  id,
  category_id: 'c1',
  name,
  slug: name.toLowerCase(),
  sku: name.toUpperCase(),
  barcode: null,
  unit: '1 pc',
  pack_size: null,
  description: null,
  image_url: null,
  purchase_cost: 100,
  custom_markup_percent: null,
  calculated_selling_price: price,
  customer_price: customer ?? price,
  is_available: true,
  is_active: true,
});
const PRODUCTS = [product('p1', 'Bread', 200, 180), product('p2', 'Eggs', 150), product('p3', 'Milk', 300)];

function renderCombos(rows: Combo[] = [BREAKFAST], onWrite?: (method: string, path: string, body: any) => ReturnType<typeof ok>) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/combos') return ok({ combos: rows });
    if (c.method === 'GET' && c.path === '/admin/products') {
      const search = (c.query.get('search') ?? '').toLowerCase();
      return ok({ products: PRODUCTS.filter((p) => p.name.toLowerCase().includes(search)) });
    }
    if (c.path.startsWith('/admin/combos')) {
      if (onWrite) return onWrite(c.method, c.path, c.body);
      return c.method === 'DELETE' ? ok({ id: 'k1', deleted: true }) : ok({ combo: { ...BREAKFAST, ...c.body } });
    }
    return undefined;
  });
  wrap(<Combos />);
  return api;
}

async function addProduct(user: ReturnType<typeof userEvent.setup>, search: string, name: string) {
  const box = screen.getByLabelText('Add a product');
  await user.clear(box);
  await user.type(box, search);
  await user.click(await screen.findByRole('button', { name: `Add ${name}` }));
}

describe('combo packs list', () => {
  it('shows price vs items, saving and live status in plain words', async () => {
    renderCombos([
      BREAKFAST,
      { ...BREAKFAST, id: 'k2', name: 'Tea pack', is_live: false, not_live_reason: 'NOT_CHEAPER', saving: 0 },
      { ...BREAKFAST, id: 'k3', name: 'Lunch pack', is_live: false, not_live_reason: 'ITEM_INACTIVE' },
      { ...BREAKFAST, id: 'k4', name: 'Snack pack', is_available: false },
      { ...BREAKFAST, id: 'k5', name: 'Old pack', is_live: false, not_live_reason: 'ENDED', ends_at: '2020-01-31T18:29:59.000Z' },
      { ...BREAKFAST, id: 'k6', name: 'Off pack', is_active: false, is_live: false, not_live_reason: 'INACTIVE' },
    ]);
    const row = (name: string) => within(screen.getByText(name).closest('tr')!);
    await screen.findByText('Breakfast pack');
    expect(row('Breakfast pack').getByText('Live')).toBeInTheDocument();
    expect(row('Breakfast pack').getByText('Bread × 1 · Eggs × 2')).toBeInTheDocument();
    expect(row('Breakfast pack').getByText('LKR 450')).toBeInTheDocument();
    expect(row('Breakfast pack').getByText('Items LKR 500')).toBeInTheDocument();
    expect(row('Breakfast pack').getByText('Saves LKR 50')).toBeInTheDocument();
    expect(row('Tea pack').getByText('Hidden: items are now cheaper than the combo')).toBeInTheDocument();
    expect(row('Tea pack').queryByText(/Saves/)).toBeNull();
    expect(row('Lunch pack').getByText('A product is switched off')).toBeInTheDocument();
    expect(row('Snack pack').getByText('Live · sold out')).toBeInTheDocument();
    expect(row('Old pack').getByText('Ended')).toBeInTheDocument();
    expect(row('Old pack').getByText('Ended 31 Jan 2020')).toBeInTheDocument();
    expect(row('Off pack').getByText('Switched off')).toBeInTheDocument();
  });

  it('deletes after a confirm', async () => {
    const user = userEvent.setup();
    const api = renderCombos();
    await user.click(await screen.findByRole('button', { name: 'Delete Breakfast pack' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete combo' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/combos/k1')).toHaveLength(1));
  });
});

describe('combo pack form', () => {
  it('builds a combo: search, quantities, live summary, rules, then the POST payload', async () => {
    const user = userEvent.setup();
    const api = renderCombos([]);
    await user.click(await screen.findByRole('button', { name: 'Add the first combo' }));
    const dialog = screen.getByRole('dialog', { name: 'Combo pack' });
    const save = within(dialog).getByRole('button', { name: 'Add combo' });
    expect(save).toBeDisabled();

    await addProduct(user, 'bre', 'Bread');
    expect(api.calls.some((c) => c.path === '/admin/products' && c.query.get('search') === 'bre')).toBe(true);
    expect(within(dialog).getByText('Add at least 2 products, or 1 product with a quantity of 2 or more.')).toBeInTheDocument();

    // One product twice is a valid pack.
    await user.click(within(dialog).getByRole('button', { name: 'One more Bread' }));
    expect(within(dialog).getByLabelText('Quantity of Bread')).toHaveValue('2');
    expect(within(dialog).queryByText(/Add at least 2 products/)).toBeNull();

    await addProduct(user, 'egg', 'Eggs');
    await user.type(within(dialog).getByLabelText('Name'), 'Breakfast pack');
    // Items: Bread 180 (customer price) x 2 + Eggs 150 = 510.
    await user.type(within(dialog).getByLabelText('Combo price (LKR)'), '600');
    const summary = within(dialog).getByRole('status', { name: 'Combo summary' });
    expect(summary).toHaveTextContent('Items separately LKR 510');
    expect(within(dialog).getByText('The combo price must be lower than the items bought separately.')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('Combo price (LKR)'));
    await user.type(within(dialog).getByLabelText('Combo price (LKR)'), '450');
    expect(summary).toHaveTextContent('Items separately LKR 510 · Combo LKR 450 · Saves LKR 60');
    expect(save).toBeEnabled();

    fireEvent.change(within(dialog).getByLabelText(/Ends/), { target: { value: '2099-12-31' } });
    await user.click(save);
    await waitFor(() => expect(api.find('POST', '/admin/combos')).toHaveLength(1));
    expect(api.find('POST', '/admin/combos')[0]?.body).toEqual({
      name: 'Breakfast pack',
      description: null,
      image_url: null,
      price: 450,
      is_active: true,
      display_order: 0,
      items: [
        { product_id: 'p1', quantity: 2 },
        { product_id: 'p2', quantity: 1 },
      ],
      ends_at: '2099-12-31T23:59:59+05:30',
    });
  });

  it('adding a product already in the pack raises its quantity instead', async () => {
    const user = userEvent.setup();
    renderCombos([]);
    await user.click(await screen.findByRole('button', { name: 'Add the first combo' }));
    await addProduct(user, 'bre', 'Bread');
    await user.click(screen.getByRole('button', { name: 'Add Bread' }));
    expect(screen.getByLabelText('Quantity of Bread')).toHaveValue('2');
    expect(screen.getAllByLabelText(/Quantity of/)).toHaveLength(1);
  });

  it('edits: items replace the list, removing a product, and shows COMBO_PRICE_NOT_LOWER by the price', async () => {
    const user = userEvent.setup();
    const api = renderCombos([BREAKFAST], (method) =>
      method === 'PATCH'
        ? fail(400, 'COMBO_PRICE_NOT_LOWER', 'The combo price must be lower.', { price: 450, items_total: 400 })
        : ok({})
    );
    await user.click(await screen.findByRole('button', { name: 'Edit Breakfast pack' }));
    const dialog = screen.getByRole('dialog', { name: 'Combo pack' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Breakfast pack');
    expect(within(dialog).getByRole('status', { name: 'Combo summary' })).toHaveTextContent(
      'Items separately LKR 500 · Combo LKR 450 · Saves LKR 50'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove Bread' }));
    // Eggs x 2 alone is still a valid pack (300), but now the price is too high.
    expect(within(dialog).getByText('The combo price must be lower than the items bought separately.')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Combo price (LKR)'));
    await user.type(within(dialog).getByLabelText('Combo price (LKR)'), '250');
    await user.click(within(dialog).getByRole('button', { name: 'Save combo' }));
    expect(
      await within(dialog).findByText('The combo price must be lower than the items today (LKR 400).')
    ).toBeInTheDocument();
    const body = api.find('PATCH', '/admin/combos/k1')[0]?.body;
    expect(body.items).toEqual([{ product_id: 'p2', quantity: 2 }]);
    expect(body.price).toBe(250);
    expect(body.ends_at).toBeNull();
  });

  it('comboProblems mirrors the API rules', () => {
    const pick = (q: string, price = 100) => ({ product_id: q + price, name: 'x', unit_price: price, image_url: null, quantity: q });
    expect(comboProblems({ name: 'Pack', price: '150', picks: [pick('2')] })).toEqual([]);
    expect(comboProblems({ name: 'Pack', price: '150', picks: [pick('1')] })).toContain(
      'Add at least 2 products, or 1 product with a quantity of 2 or more.'
    );
    expect(comboProblems({ name: 'Pack', price: '0', picks: [pick('2')] })).toContain(
      'Enter a combo price above 0 with at most 2 decimals.'
    );
    expect(comboProblems({ name: 'Pack', price: '10.123', picks: [pick('2')] })).toContain(
      'Enter a combo price above 0 with at most 2 decimals.'
    );
    expect(comboProblems({ name: 'Pack', price: '200', picks: [pick('2')] })).toContain(
      'The combo price must be lower than the items bought separately.'
    );
    expect(comboProblems({ name: 'Pack', price: '150', picks: [pick('1.5'), pick('1', 50)] })).toContain(
      'Each quantity must be a whole number from 1 to 100.'
    );
    expect(comboProblems({ name: 'P', price: '150', picks: [pick('2')] })).toContain(
      'Give the combo a name (at least 2 characters).'
    );
  });
});

// ---------------------------------------------------------------- orders
describe('order items grouped by combo', () => {
  const COMBO: OrderCombo = {
    id: 'oc1',
    order_id: 'o1',
    combo_id: 'k1',
    name: 'Breakfast pack',
    unit_price: 450,
    quantity: 2,
    subtotal: 900,
    items_regular_total: 500,
  };
  const row = (id: string, name: string, quantity: number, comboId: string | null, productId = id): OrderItemRow => ({
    id,
    product_name_snapshot: name,
    quantity,
    item_status: 'PENDING',
    product_id: productId,
    order_combo_id: comboId,
  });
  const ITEMS = [
    row('i1', 'Bread', 1, 'oc1', 'p1'),
    // The same product split across two lines to carry leftover cents.
    row('i2', 'Bread', 1, 'oc1', 'p1'),
    row('i3', 'Eggs', 4, 'oc1', 'p2'),
    row('i4', 'Rice 5kg', 1, null, 'p9'),
  ];

  it('groupOrderItems puts combo items under their combo and merges duplicate product lines', () => {
    const grouped = groupOrderItems(ITEMS, [COMBO]);
    expect(grouped.combos).toHaveLength(1);
    expect(grouped.combos[0].items.map((i) => [i.product_name_snapshot, i.quantity])).toEqual([
      ['Bread', 2],
      ['Eggs', 4],
    ]);
    expect(grouped.loose.map((i) => i.product_name_snapshot)).toEqual(['Rice 5kg']);
  });

  it('older responses without combos list every item as before', () => {
    const grouped = groupOrderItems(ITEMS.slice(3));
    expect(grouped.combos).toEqual([]);
    expect(grouped.loose).toHaveLength(1);
  });

  it('renders "Breakfast pack × 2" with its subtotal and items, then loose items', () => {
    render(<OrderItems items={ITEMS} combos={[COMBO]} />);
    const combo = screen.getByRole('listitem', { name: 'Combo Breakfast pack' });
    expect(within(combo).getByText('Breakfast pack × 2')).toBeInTheDocument();
    expect(within(combo).getByText('LKR 900')).toBeInTheDocument();
    expect(within(combo).getByText('Bread')).toBeInTheDocument();
    expect(within(combo).getByText('2 ×')).toBeInTheDocument();
    expect(within(combo).getByText('Eggs')).toBeInTheDocument();
    expect(within(combo).queryByText('Rice 5kg')).toBeNull();
    expect(screen.getByText('Rice 5kg')).toBeInTheDocument();
  });
});
