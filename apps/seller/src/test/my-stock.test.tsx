import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';
import { product, renderApp, seller, signInStoredSession, submission, worldHandler } from './fixtures';
import { digitsOnly, parseStock, stepStock, stockBadge, stockable } from '../lib/stock';
import type { SellerProduct } from '../api/types';

beforeEach(() => signInStoredSession());

const PRODUCTS: SellerProduct[] = [
  product({ id: 'p1', name: 'Kithul Treacle', stock_on_hand: 12, stock_reserved: 2 }),
  product({ id: 'p2', name: 'Mango Jam', stock_on_hand: 3, stock_reserved: 0 }),
  product({ id: 'p3', name: 'Jaggery', stock_on_hand: 0, stock_reserved: 0 }),
  // Only a submission so far: no stock yet.
  product({ id: 'submission:s9', name: 'Lime Pickle', live: false, selling_price: null, stock_on_hand: null, stock_reserved: null, pending: submission() }),
];

/** The fake API; PUT /seller/products/:id/stock answers through `put` (default: accepts the number). */
function stockWorld(opts: { products?: SellerProduct[]; put?: (call: Call) => Reply | undefined; status?: 'APPROVED' | 'PENDING' } = {}) {
  return mockApi(
    worldHandler({
      seller: seller({ status: opts.status ?? 'APPROVED' }),
      products: opts.products ?? PRODUCTS,
      extra: (call) => {
        const put = call.method === 'PUT' && call.path.match(/^\/seller\/products\/([^/]+)\/stock$/);
        if (!put) return undefined;
        const custom = opts.put?.(call);
        if (custom) return custom;
        const reserved = (opts.products ?? PRODUCTS).find((p) => p.id === put[1])?.stock_reserved ?? 0;
        return ok({ product_id: put[1], stock_on_hand: call.body.quantity, stock_reserved: reserved, previous: 12 });
      },
    })
  );
}

describe('My stock', () => {
  it('lists every approved product with its number and the Out of stock / Low badges; pending ones have no box', async () => {
    stockWorld();
    renderApp('/stock');
    expect(await screen.findByRole('heading', { name: 'My stock' })).toBeInTheDocument();

    const treacle = await screen.findByRole('listitem', { name: 'Kithul Treacle' });
    expect(within(treacle).getByTestId('on-hand-p1')).toHaveTextContent('12');
    expect(within(treacle).getByLabelText('Stock of Kithul Treacle')).toHaveValue('12');
    expect(within(treacle).getByText(/2 reserved for open orders/i)).toBeInTheDocument();
    expect(within(treacle).queryByText('Low')).not.toBeInTheDocument();
    expect(within(treacle).queryByText('Out of stock')).not.toBeInTheDocument();

    expect(within(screen.getByRole('listitem', { name: 'Mango Jam' })).getByText('Low')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Jaggery' })).getByText('Out of stock')).toBeInTheDocument();

    // A product still waiting for Blynk shows no stock input.
    expect(screen.queryByRole('listitem', { name: 'Lime Pickle' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stock of Lime Pickle')).not.toBeInTheDocument();
    expect(screen.getByText(/1 product is waiting for blynk to approve/i)).toBeInTheDocument();
  });

  it('steps with + and -, saves with PUT, and shows the new number', async () => {
    const api = stockWorld();
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Mango Jam' }));
    const save = row.getByRole('button', { name: 'Save stock of Mango Jam' });
    expect(save).toBeDisabled();

    await userEvent.click(row.getByRole('button', { name: 'One more Mango Jam' }));
    await userEvent.click(row.getByRole('button', { name: 'One more Mango Jam' }));
    await userEvent.click(row.getByRole('button', { name: 'One less Mango Jam' }));
    expect(row.getByLabelText('Stock of Mango Jam')).toHaveValue('4');
    expect(save).toBeEnabled();

    await userEvent.click(save);
    expect(await row.findByText('Saved. 4 in stock.')).toBeInTheDocument();
    expect(api.find('PUT', '/seller/products/p2/stock')).toHaveLength(1);
    expect(api.find('PUT', '/seller/products/p2/stock')[0]!.body).toEqual({ quantity: 4 });
    expect(row.getByTestId('on-hand-p2')).toHaveTextContent('4');
    // Saved, so there is nothing left to save.
    expect(save).toBeDisabled();
  });

  it('typing a number and pressing Enter saves it; 0 marks the product Out of stock', async () => {
    const api = stockWorld();
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Kithul Treacle' }));
    const box = row.getByLabelText('Stock of Kithul Treacle');
    await userEvent.clear(box);
    await userEvent.type(box, '0{Enter}');
    expect(await row.findByText('Out of stock')).toBeInTheDocument();
    expect(api.find('PUT', '/seller/products/p1/stock')[0]!.body).toEqual({ quantity: 0 });
    expect(row.getByTestId('on-hand-p1')).toHaveTextContent('0');
  });

  it('shows the server\'s friendly error under the box and keeps the old number', async () => {
    stockWorld({
      put: () =>
        fail(400, 'INSUFFICIENT_AVAILABLE_INVENTORY', '2 are already reserved for open orders, so the stock cannot go below 2.'),
    });
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Kithul Treacle' }));
    const box = row.getByLabelText('Stock of Kithul Treacle');
    await userEvent.clear(box);
    await userEvent.type(box, '1');
    await userEvent.click(row.getByRole('button', { name: 'Save stock of Kithul Treacle' }));
    expect(await row.findByRole('alert')).toHaveTextContent('2 are already reserved for open orders, so the stock cannot go below 2.');
    expect(row.getByTestId('on-hand-p1')).toHaveTextContent('12');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // Editing again clears the message.
    await userEvent.type(box, '0');
    expect(row.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when Blynk switched the product to untracked, with no box', async () => {
    stockWorld({ products: [product({ id: 'p1', name: 'Rice', stock_on_hand: null, stock_reserved: null, stock_tracked: false })] });
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Rice' }));
    expect(row.getByText(/blynk does not count this product's stock/i)).toBeInTheDocument();
    expect(row.queryByLabelText('Stock of Rice')).not.toBeInTheDocument();
  });

  it('a product Blynk has no number for yet starts empty and can be set', async () => {
    const api = stockWorld({ products: [product({ id: 'p1', name: 'Rice', stock_on_hand: null, stock_reserved: null })] });
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Rice' }));
    expect(row.getByText('not set yet')).toBeInTheDocument();
    expect(row.getByLabelText('Stock of Rice')).toHaveValue('');
    await userEvent.type(row.getByLabelText('Stock of Rice'), '25');
    await userEvent.click(row.getByRole('button', { name: 'Save stock of Rice' }));
    expect(await row.findByText('Saved. 25 in stock.')).toBeInTheDocument();
    expect(api.find('PUT', '/seller/products/p1/stock')[0]!.body).toEqual({ quantity: 25 });
  });

  it('the box accepts digits only and refuses more than 100,000', async () => {
    const api = stockWorld();
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Mango Jam' }));
    const box = row.getByLabelText('Stock of Mango Jam');
    await userEvent.clear(box);
    await userEvent.type(box, '1a2.5');
    expect(box).toHaveValue('125');
    await userEvent.clear(box);
    await userEvent.type(box, '999999');
    expect(await row.findByRole('alert')).toHaveTextContent(/whole number from 0 to 100,000/i);
    expect(row.getByRole('button', { name: 'Save stock of Mango Jam' })).toBeDisabled();
    expect(api.find('PUT', '/seller/products/p2/stock')).toHaveLength(0);
  });

  it('has no stock notes and no "bring stock" wording anywhere', async () => {
    const api = stockWorld();
    renderApp('/stock');
    await screen.findByRole('heading', { name: 'My stock' });
    await screen.findByRole('listitem', { name: 'Mango Jam' });
    expect(api.calls.some((c) => c.path.startsWith('/seller/stock-notes'))).toBe(false);
    expect(document.body.textContent).not.toMatch(/send stock|bring more|on the way|blynk will receive|goods on/i);
  });

  it('a shop that is not approved cannot change stock', async () => {
    stockWorld({ status: 'PENDING', products: [product({ id: 'p1', name: 'Rice' })] });
    renderApp('/stock');
    const row = within(await screen.findByRole('listitem', { name: 'Rice' }));
    expect(row.getByLabelText('Stock of Rice')).toBeDisabled();
    expect(screen.getByText(/once blynk has approved your shop/i)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is live yet', async () => {
    stockWorld({ products: [PRODUCTS[3]!] });
    renderApp('/stock');
    expect(await screen.findByText('No products to count yet')).toBeInTheDocument();
  });

  it('is reached from the My stock tab', async () => {
    stockWorld();
    renderApp('/products');
    await userEvent.click(await screen.findByRole('link', { name: /^my stock$/i }));
    expect(await screen.findByRole('heading', { name: 'My stock' })).toBeInTheDocument();
  });
});

describe('My products card', () => {
  it('shows the number as In stock and links to My stock (no Bring more)', async () => {
    mockApi(worldHandler({ products: [product({ id: 'p1', name: 'Kithul Treacle', stock_on_hand: 12 })] }));
    renderApp('/products');
    const card = within(await screen.findByRole('article', { name: 'Kithul Treacle' }));
    expect(card.getByText('In stock')).toBeInTheDocument();
    expect(card.queryByText(/bring more/i)).not.toBeInTheDocument();
    expect(card.getByRole('link', { name: /update stock/i })).toHaveAttribute('href', '/stock');
  });
});

describe('stock helpers', () => {
  it('words the badges', () => {
    expect(stockBadge(0)).toEqual({ label: 'Out of stock', tone: 'bad' });
    expect(stockBadge(1)).toEqual({ label: 'Low', tone: 'wait' });
    expect(stockBadge(5)).toEqual({ label: 'Low', tone: 'wait' });
    expect(stockBadge(6)).toBeNull();
    expect(stockBadge(null)).toBeNull();
  });

  it('parses and steps whole numbers from 0 to 100,000', () => {
    expect(parseStock('0')).toBe(0);
    expect(parseStock(' 120 ')).toBe(120);
    expect(parseStock('100000')).toBe(100000);
    expect(parseStock('100001')).toBeNull();
    expect(parseStock('')).toBeNull();
    expect(parseStock('1.5')).toBeNull();
    expect(digitsOnly('a1b2c3')).toBe('123');
    expect(stepStock('', 1)).toBe('1');
    expect(stepStock('0', -1)).toBe('0');
    expect(stepStock('100000', 1)).toBe('100000');
    expect(stepStock('7', -1)).toBe('6');
  });

  it('only live products of the shop get a stock box', () => {
    const list = [product({ id: 'a' }), product({ id: 'submission:b', live: false }), product({ id: 'c', live: false })];
    expect(stockable(list).map((p) => p.id)).toEqual(['a']);
  });
});
