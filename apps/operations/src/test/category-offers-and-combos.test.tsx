import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category, Combo, OrderDetail } from '../api/types';
import { comboRuleError, parseOfferPercent } from '../lib/catalog';
import { groupOrderItems } from '../lib/orders';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/**
 * Category offers and combo packs (migration 033; owner, 2026-10-09):
 * % off a whole category from its edit dialog, the Combo packs screen, and
 * combo contents grouped on the order page and packing slip.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'c1',
    name: 'Bakery',
    slug: 'bakery',
    description: null,
    image_url: null,
    display_order: 1,
    is_active: true,
    parent_id: null,
    offer_percent: null,
    offer_ends_at: null,
    offer_active: false,
    ...overrides,
  };
}

const BREAD = category({ id: 'c2', name: 'Bread', slug: 'bread', parent_id: 'c1' });

function openCategories(rows: Category[], extra: NonNullable<Parameters<typeof renderAs>[2]> = {}) {
  return renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
    'GET /admin/categories': () => ok({ categories: rows }),
    'GET /admin/category-groups': () => ok({ groups: [], unassigned: [] }),
    ...extra,
  });
}

async function editBakery() {
  const user = userEvent.setup();
  const row = (await screen.findByText('Bakery')).closest('li')!;
  await user.click(within(row).getByRole('button', { name: 'Edit' }));
  return { user, dialog: screen.getByRole('dialog', { name: 'Category' }) };
}

describe('lib - category offer % and combo rules', () => {
  it('mirrors the server checks', () => {
    expect(parseOfferPercent('10')).toEqual({ value: 10 });
    expect(parseOfferPercent('12.5')).toEqual({ value: 12.5 });
    expect(parseOfferPercent('0')).toEqual({ error: 'The offer must be more than 0%.' });
    expect(parseOfferPercent('100')).toEqual({ error: 'The offer must be less than 100%.' });
    expect(parseOfferPercent('10.555')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseOfferPercent('ten')).toHaveProperty('error');

    expect(comboRuleError([{ quantity: 1 }], 100, 200)).toMatch(/at least 2 products/);
    expect(comboRuleError([{ quantity: 2 }], 100, 200)).toBeNull();
    expect(comboRuleError([{ quantity: 1 }, { quantity: 1 }], 200, 200)).toMatch(/lower than buying the items separately/);
    expect(comboRuleError([{ quantity: 1 }, { quantity: 1 }], 150, 200)).toBeNull();
  });
});

describe('Categories - offer', () => {
  it('shows an "x% off" tag on a category whose offer is running', async () => {
    openCategories([category({ offer_percent: 10, offer_active: true }), BREAD]);
    const row = (await screen.findByText('Bakery')).closest('li')!;
    expect(within(row).getByText('10% off')).toBeInTheDocument();
    const child = screen.getByText('Bread').closest('li')!;
    expect(within(child).queryByText(/% off/)).not.toBeInTheDocument();
  });

  it('saves an offer with an end day, previewing it including the sub-categories', async () => {
    const { api } = openCategories([category(), BREAD], {
      'PUT /admin/categories/:id/offer': (call) =>
        ok({
          category: category({
            offer_percent: call.body.offer_percent,
            offer_ends_at: '2099-10-31T18:29:59.000Z',
            offer_active: true,
          }),
        }),
    });
    const { user, dialog } = await editBakery();
    await user.type(within(dialog).getByLabelText(/^Offer \(% off\)/), '10');
    fireEvent.change(within(dialog).getByLabelText(/^Offer ends/), { target: { value: '2099-10-31' } });
    expect(
      within(dialog).getByText('10% off everything in Bakery and its sub-categories (Bread) until 31 Oct 2099.')
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save offer' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/c1/offer')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/c1/offer')[0]!.body).toEqual({
      offer_percent: 10,
      offer_ends_at: '2099-10-31T23:59:59+05:30',
    });
    expect(await within(dialog).findByText('Running now')).toBeInTheDocument();
    // The category's own form was not submitted.
    expect(api.find('PATCH', '/admin/categories/c1')).toHaveLength(0);
  });

  it('refuses 100% without calling the API, and shows the server refusal as it says it', async () => {
    const { api } = openCategories([category()], {
      'PUT /admin/categories/:id/offer': () => fail(400, 'OFFER_END_IN_PAST', 'The offer end date must be in the future.'),
    });
    const { user, dialog } = await editBakery();
    const input = within(dialog).getByLabelText(/^Offer \(% off\)/);
    await user.type(input, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save offer' }));
    expect(within(dialog).getByText('The offer must be less than 100%.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/categories/c1/offer')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '15');
    await user.click(within(dialog).getByRole('button', { name: 'Save offer' }));
    expect(await within(dialog).findByText('The offer end date must be in the future.')).toBeInTheDocument();
  });

  it('removes a running offer, and shows an ended one as ended', async () => {
    const { api } = openCategories(
      [category({ offer_percent: 10, offer_ends_at: '2020-01-31T18:29:59.000Z', offer_active: false })],
      { 'DELETE /admin/categories/:id/offer': () => ok({ category: category() }) }
    );
    const { user, dialog } = await editBakery();
    expect(within(dialog).getByText('Ended on 31 Jan 2020')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove offer' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1/offer')).toHaveLength(1));
    expect(await within(dialog).findByText('Offer removed.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Offer \(% off\)/)).toHaveValue('');
  });
});

// ---------------------------------------------------------------- combos
function combo(overrides: Partial<Combo> = {}): Combo {
  return {
    id: 'k1',
    name: 'Breakfast pack',
    description: null,
    image_url: null,
    price: 490,
    is_active: true,
    ends_at: null,
    display_order: 0,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
    items: [
      {
        product_id: 'p1',
        name: 'Bread',
        slug: 'bread',
        sku: 'B1',
        unit: '450 g',
        pack_size: null,
        image_url: null,
        quantity: 1,
        selling_price: 200,
        unit_price: 200,
        is_active: true,
        is_available: true,
        in_stock: true,
        stock_available: null,
      },
      {
        product_id: 'p2',
        name: 'Milk',
        slug: 'milk',
        sku: 'M1',
        unit: '1 L',
        pack_size: null,
        image_url: null,
        quantity: 1,
        selling_price: 350,
        unit_price: 350,
        is_active: true,
        is_available: true,
        in_stock: true,
        stock_available: 4,
      },
    ],
    items_total: 550,
    saving: 60,
    is_live: true,
    is_available: true,
    not_live_reason: null,
    ...overrides,
  };
}

function product(overrides: Partial<AdminProduct>): AdminProduct {
  return {
    id: 'p1',
    category_id: 'c1',
    name: 'Bread',
    slug: 'bread',
    sku: 'B1',
    barcode: null,
    unit: '450 g',
    pack_size: null,
    description: null,
    image_url: null,
    purchase_cost: 150,
    custom_markup_percent: null,
    calculated_selling_price: 200,
    is_available: true,
    is_active: true,
    ...overrides,
  };
}

const PRODUCTS = [
  product({ id: 'p1', name: 'Bread', calculated_selling_price: 220, customer_price: 200 }),
  product({ id: 'p2', name: 'Butter', calculated_selling_price: 300 }),
];

describe('Combo packs', () => {
  it('is reachable from the Catalog hub', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog', {
      'GET /admin/combos': () => ok({ combos: [combo()] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /admin/category-groups': () => ok({ groups: [], unassigned: [] }),
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/products': () => ok({ products: [], pagination: {} }),
      'GET /admin/inventory/stock': () => ok({ inventory: [] }),
      'GET /admin/dental/clinics': () => ok({ clinics: [] }),
    });
    const card = (await screen.findByText('Combo packs')).closest('a')!;
    expect(card).toHaveAttribute('href', '/catalog/combos');
    await waitFor(() => expect(within(card).getByText('1')).toBeInTheDocument());
  });

  it('lists combos with price, saving and live status in plain words', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/combos', {
      'GET /admin/combos': () =>
        ok({
          combos: [
            combo(),
            combo({ id: 'k2', name: 'Tea pack', is_live: false, not_live_reason: 'NOT_CHEAPER', saving: 0 }),
            combo({ id: 'k3', name: 'Old pack', is_live: false, not_live_reason: 'ENDED' }),
            combo({ id: 'k4', name: 'Off pack', is_live: false, not_live_reason: 'INACTIVE' }),
            combo({ id: 'k5', name: 'Gone pack', is_live: false, not_live_reason: 'ITEM_INACTIVE' }),
            combo({ id: 'k6', name: 'Sold pack', is_available: false }),
          ],
        }),
    });
    const live = (await screen.findByText('Breakfast pack')).closest('li')!;
    expect(live).toHaveTextContent('1 × Bread, 1 × Milk');
    expect(live).toHaveTextContent('LKR 490');
    expect(live).toHaveTextContent('LKR 550');
    expect(within(live).getByText('Saves LKR 60')).toBeInTheDocument();
    expect(within(live).getByText('Live')).toBeInTheDocument();

    const row = (name: string) => screen.getByText(name).closest('li')!;
    expect(row('Tea pack')).toHaveTextContent('Hidden: items are now cheaper than the combo');
    expect(row('Old pack')).toHaveTextContent('Ended');
    expect(row('Off pack')).toHaveTextContent('Switched off');
    expect(row('Gone pack')).toHaveTextContent('A product is switched off');
    expect(within(row('Sold pack')).getByText('Sold out')).toBeInTheDocument();
  });

  it('builds a combo from a product search, with a live saving, and blocks save until the rules are met', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/combos', {
      'GET /admin/combos': () => ok({ combos: [] }),
      'GET /admin/products': (call) =>
        ok({ products: PRODUCTS.filter((p) => p.name.toLowerCase().includes((call.query.search ?? '').toLowerCase())) }),
      'POST /admin/combos': (call) => ({ status: 201, data: { combo: combo({ name: call.body.name }) } }),
    });
    await user.click((await screen.findAllByRole('button', { name: 'Add combo' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Combo pack' });
    const save = within(dialog).getByRole('button', { name: 'Save' });

    await user.type(within(dialog).getByLabelText(/^Name/), 'Breakfast pack');
    await user.type(within(dialog).getByLabelText(/^Combo price/), '450');
    await user.type(within(dialog).getByLabelText(/^Add a product/), 'bre');
    await user.click(await within(dialog).findByRole('button', { name: 'Add Bread' }));
    // One of one product breaks the rule.
    expect(within(dialog).getByText('A combo needs at least 2 products, or 2 or more of one product.')).toBeInTheDocument();
    expect(save).toBeDisabled();

    // Two of it: allowed, but LKR 450 is not below 2 x LKR 200 (customer_price wins over the selling price).
    await user.click(within(dialog).getByRole('button', { name: 'One more Bread' }));
    expect(within(dialog).getByText('The combo price must be lower than buying the items separately.')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/^Add a product/));
    await user.type(within(dialog).getByLabelText(/^Add a product/), 'butt');
    await user.click(await within(dialog).findByRole('button', { name: 'Add Butter' }));
    const summary = within(dialog).getByText(/Items separately/).closest('p')!;
    expect(summary).toHaveTextContent('Items separately LKR 700');
    expect(summary).toHaveTextContent('Combo LKR 450');
    expect(summary).toHaveTextContent('Customer saves LKR 250');
    expect(save).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove Butter' }));
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add Butter' }));

    fireEvent.change(within(dialog).getByLabelText(/^Ends/), { target: { value: '2099-12-31' } });
    await user.click(save);
    await waitFor(() => expect(api.find('POST', '/admin/combos')).toHaveLength(1));
    expect(api.find('POST', '/admin/combos')[0]!.body).toEqual({
      name: 'Breakfast pack',
      description: null,
      image_url: null,
      price: 450,
      is_active: true,
      ends_at: '2099-12-31T23:59:59+05:30',
      items: [
        { product_id: 'p1', quantity: 2 },
        { product_id: 'p2', quantity: 1 },
      ],
    });
    expect(await screen.findByText('Breakfast pack was added.')).toBeInTheDocument();
  });

  it('edits a combo without resending an untouched end, and shows a server refusal', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/combos', {
      'GET /admin/combos': () => ok({ combos: [combo({ ends_at: '2099-10-31T18:29:59.000Z' })] }),
      'PATCH /admin/combos/:id': () => ({
        status: 400,
        error: { code: 'COMBO_PRICE_NOT_LOWER', message: 'The combo price must be lower than the items (LKR 550.00).' },
      }),
    });
    const row = (await screen.findByText('Breakfast pack')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Combo pack' });
    expect(within(dialog).getByLabelText(/^Ends/)).toHaveValue('2099-10-31');
    const price = within(dialog).getByLabelText(/^Combo price/);
    await user.clear(price);
    await user.type(price, '500');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/combos/k1')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/combos/k1')[0]!.body as Record<string, unknown>;
    expect(body.price).toBe(500);
    expect(body).not.toHaveProperty('ends_at');
    expect(body.items).toEqual([
      { product_id: 'p1', quantity: 1 },
      { product_id: 'p2', quantity: 1 },
    ]);
    expect(await within(dialog).findByText('The combo price must be lower than the items (LKR 550.00).')).toBeInTheDocument();
  });

  it('deletes a combo after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/combos', {
      'GET /admin/combos': () => ok({ combos: [combo()] }),
      'DELETE /admin/combos/:id': () => ok({ id: 'k1', deleted: true }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Breakfast pack' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete combo pack' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/combos/k1')).toHaveLength(1));
    expect(await screen.findByText('Breakfast pack was deleted.')).toBeInTheDocument();
  });
});

// ------------------------------------------------- order detail + packing slip
function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    order_number: 'BL-20261009-0007',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: 1230,
    placed_at: '2026-10-09T04:30:00Z',
    scheduled_for: null,
    delivery_recipient_name: 'Fathima Nusra',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '3 Main Street',
    delivery_address_line2: null,
    delivery_city: 'Beruwala',
    delivery_instructions: null,
    cancellation_reason: null,
    combos: [
      {
        id: 'oc1',
        order_id: 'o1',
        combo_id: 'k1',
        name: 'Breakfast pack',
        unit_price: 490,
        quantity: 2,
        subtotal: 980,
        items_regular_total: 550,
      },
    ],
    items: [
      { id: 'i1', product_id: 'p9', product_name_snapshot: 'Sugar 1kg', unit_snapshot: '1 kg', quantity: 1, item_status: 'PENDING', order_combo_id: null },
      // The same product split over two lines inside the combo (cents shared out).
      { id: 'i2', product_id: 'p1', product_name_snapshot: 'Bread', unit_snapshot: '450 g', quantity: 1, item_status: 'PENDING', order_combo_id: 'oc1' },
      { id: 'i3', product_id: 'p1', product_name_snapshot: 'Bread', unit_snapshot: '450 g', quantity: 1, item_status: 'PENDING', order_combo_id: 'oc1' },
      { id: 'i4', product_id: 'p2', product_name_snapshot: 'Milk', unit_snapshot: '1 L', quantity: 2, item_status: 'PENDING', order_combo_id: 'oc1' },
    ],
    history: [],
    delivery: null,
    ...overrides,
  };
}

describe('Orders - combo contents', () => {
  it('groups combo items under their combo, merging a split product; loose items stay loose', () => {
    const grouped = groupOrderItems(order());
    expect(grouped.combos).toHaveLength(1);
    expect(grouped.combos[0]!.rows.map((r) => [r.item.product_name_snapshot, r.quantity, r.ids])).toEqual([
      ['Bread', 2, ['i2', 'i3']],
      ['Milk', 2, ['i4']],
    ]);
    expect(grouped.loose.map((r) => r.item.id)).toEqual(['i1']);
    // Old data with no combos array renders every item loose.
    const old = order({ combos: undefined, items: order().items.map(({ order_combo_id: _c, ...i }) => i) });
    expect(groupOrderItems(old).loose).toHaveLength(4);
  });

  it('order detail shows the combo heading with its items, and marks a merged row unavailable line by line', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'POST /admin/orders/:id/resolve-item': () => ok({}),
    });
    const group = await screen.findByRole('group', { name: 'Breakfast pack' }, { timeout: 5000 });
    expect(within(group).getByRole('heading')).toHaveTextContent('Breakfast pack × 2 — LKR 980');
    const rows = within(group).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.order-items__name')!.textContent)).toEqual(['Bread', 'Milk']);
    expect(rows[0]).toHaveTextContent('2 ×');
    expect(screen.getByText('Other items')).toBeInTheDocument();
    expect(screen.getByText('Sugar 1kg')).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Mark Bread unavailable' }));
    await user.click(screen.getByRole('button', { name: 'Mark unavailable' }));
    await waitFor(() => expect(api.find('POST', '/admin/orders/o1/resolve-item')).toHaveLength(2));
    expect(api.find('POST', '/admin/orders/o1/resolve-item').map((c) => c.body.item_id)).toEqual(['i2', 'i3']);
  });

  it('packing slip lists the combo under its heading, then the other items', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order: order() }) });
    const slip = await screen.findByRole('article', { name: 'Packing slip' }, { timeout: 5000 });
    const rows = within(slip)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(rows).toEqual([
      'Breakfast pack × 2 — LKR 980',
      '2Bread450 g',
      '2Milk1 L',
      'Other items',
      '1Sugar 1kg1 kg',
    ]);
  });
});
