import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, type Call } from './mockApi';
import { product, renderApp, seller, signInStoredSession, stockNote, worldHandler } from './fixtures';
import { todayColombo } from '../lib/format';
import { addDays, noteChip } from '../lib/requests';
import type { StockNote } from '../api/types';

beforeEach(() => signInStoredSession());

const PRODUCTS = [
  product({ id: 'p1', name: 'Kithul Treacle', stock_on_hand: 12 }),
  product({ id: 'p2', name: 'Mango Jam', stock_on_hand: 3 }),
  // Only a submission so far: no stock notes for it.
  product({ id: 'submission:s9', name: 'Lime Pickle', live: false, selling_price: null, stock_on_hand: null }),
];

/** A fake API whose stock notes live in `notes` (POST adds, DELETE cancels). */
function stockWorld(notes: StockNote[], opts: { post?: (call: Call) => ReturnType<typeof ok> | undefined; status?: 'APPROVED' | 'PENDING' } = {}) {
  return mockApi(
    worldHandler({
      seller: seller({ status: opts.status ?? 'APPROVED' }),
      products: PRODUCTS,
      extra: (call) => {
        if (call.path === '/seller/insights') return fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.');
        if (call.method === 'GET' && call.path === '/seller/stock-notes') return ok({ notes });
        if (call.method === 'POST' && call.path === '/seller/stock-notes') {
          const custom = opts.post?.(call);
          if (custom) return custom;
          const note = stockNote({
            id: `n${notes.length + 1}`,
            product_id: call.body.product_id,
            product_name: PRODUCTS.find((p) => p.id === call.body.product_id)!.name,
            quantity: call.body.quantity,
            expected_on: call.body.expected_on,
            note: call.body.note ?? null,
          });
          notes.unshift(note);
          return { status: 201, data: { note } };
        }
        const cancel = call.method === 'DELETE' && call.path.match(/^\/seller\/stock-notes\/(.+)$/);
        if (cancel) {
          const note = notes.find((n) => n.id === cancel[1]);
          if (note) note.status = 'CANCELLED';
          return ok({ note });
        }
        return undefined;
      },
    })
  );
}

describe('send stock to Blynk from a product card', () => {
  it('"Bring more" sends how many, the day and a note, then says it is on the way', async () => {
    const notes: StockNote[] = [];
    const api = stockWorld(notes);
    renderApp('/products');

    const card = await screen.findByRole('article', { name: 'Kithul Treacle' }, { timeout: 15_000 });
    await userEvent.click(await within(card).findByRole('button', { name: /bring more/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Bring more Kithul Treacle' });
    const box = within(dialog);
    expect(box.getByText('12 at Blynk now')).toBeInTheDocument();

    await userEvent.type(box.getByLabelText(/how many/i), '20');
    await userEvent.click(box.getByRole('button', { name: 'One more' }));
    await userEvent.click(box.getByRole('button', { name: 'In 2 days' }));
    await userEvent.type(box.getByLabelText(/note for blynk/i), 'New batch');
    await userEvent.click(box.getByRole('button', { name: /send to blynk/i }));

    expect(await screen.findByText(/sent\. blynk knows 21 × kithul treacle is coming on /i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.find('POST', '/seller/stock-notes')[0]!.body).toEqual({
      product_id: 'p1',
      quantity: 21,
      expected_on: addDays(todayColombo(), 2),
      note: 'New batch',
    });
    // The card now shows what is coming.
    expect(await within(card).findByText(/21 on the way to blynk/i)).toBeInTheDocument();
  });

  it('checks the amount before sending', async () => {
    const api = stockWorld([]);
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Mango Jam' });
    await userEvent.click(await within(card).findByRole('button', { name: /bring more/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: /send to blynk/i }));
    expect(await dialog.findByText(/enter how many you are bringing/i)).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText(/how many/i), '20000');
    await userEvent.click(dialog.getByRole('button', { name: /send to blynk/i }));
    expect(await dialog.findByText(/10,000 at most/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/stock-notes')).toHaveLength(0);
  });

  it('has no "Bring more" while the server is not ready (503 SELLER_REQUESTS_NOT_READY)', async () => {
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) =>
          call.path.startsWith('/seller/stock-notes') || call.path === '/seller/insights'
            ? fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.')
            : undefined,
      })
    );
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByRole('link', { name: /edit/i })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /bring more/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the feature gently when sending finds the server not ready', async () => {
    stockWorld([], { post: () => fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.') as ReturnType<typeof ok> });
    renderApp('/stock');
    await userEvent.click(await screen.findByRole('button', { name: /send stock to blynk/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.selectOptions(dialog.getByLabelText(/^product/i), 'p2');
    await userEvent.type(dialog.getByLabelText(/how many/i), '5');
    await userEvent.click(dialog.getByRole('button', { name: /send to blynk/i }));
    expect(await screen.findByText(/sending stock notes is not switched on yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /stock you are bringing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send stock to blynk/i })).not.toBeInTheDocument();
  });

  it('is not offered before the shop is approved', async () => {
    stockWorld([], { status: 'PENDING' });
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).queryByRole('button', { name: /bring more/i })).not.toBeInTheDocument();
  });
});

describe('the Stock screen', () => {
  it('lists the notes with their status and the stock at Blynk', async () => {
    stockWorld([
      stockNote({ id: 'n1', quantity: 24, status: 'SENT', note: 'Big bottles' }),
      stockNote({ id: 'n2', product_id: 'p2', product_name: 'Mango Jam', quantity: 24, status: 'RECEIVED', received_quantity: 20, received_at: '2026-10-20T05:00:00.000Z' }),
      stockNote({ id: 'n3', product_id: 'p2', product_name: 'Mango Jam', quantity: 10, status: 'RECEIVED', received_quantity: 10, received_at: '2026-10-12T05:00:00.000Z' }),
      stockNote({ id: 'n4', quantity: 6, status: 'CANCELLED' }),
    ]);
    renderApp('/stock');
    expect(await screen.findByRole('heading', { name: /^stock$/i })).toBeInTheDocument();

    expect(await screen.findByRole('article', { name: 'Kithul Treacle, On its way' })).toHaveTextContent(/big bottles/i);
    expect(screen.getByRole('article', { name: 'Mango Jam, Received 20 of 24' })).toHaveTextContent(/arrived 20 oct 2026/i);
    expect(screen.getByRole('article', { name: 'Mango Jam, Received 10' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Kithul Treacle, Cancelled' })).toBeInTheDocument();

    const onhand = screen.getByRole('heading', { name: /stock at blynk now/i }).closest('section')!;
    expect(within(onhand).getByText('Kithul Treacle')).toBeInTheDocument();
    expect(within(onhand).getByText(/24 coming/i)).toBeInTheDocument();
    expect(within(onhand).getByText('Running low')).toBeInTheDocument();
    // A product that is only a submission cannot have stock yet.
    expect(within(onhand).queryByText('Lime Pickle')).not.toBeInTheDocument();
  });

  it('sends a note for a chosen product from the Stock screen', async () => {
    const notes: StockNote[] = [];
    const api = stockWorld(notes);
    renderApp('/stock');
    expect(await screen.findByText('No stock notes yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /send stock to blynk/i }));
    const dialog = within(await screen.findByRole('dialog', { name: /bring stock to the blynk store/i }));
    await userEvent.click(dialog.getByRole('button', { name: /send to blynk/i }));
    expect(await dialog.findByText(/choose the product you are bringing/i)).toBeInTheDocument();
    await userEvent.selectOptions(dialog.getByLabelText(/^product/i), 'p2');
    await userEvent.type(dialog.getByLabelText(/how many/i), '12');
    await userEvent.click(dialog.getByRole('button', { name: 'Today' }));
    await userEvent.click(dialog.getByRole('button', { name: /send to blynk/i }));

    expect(await screen.findByText(/blynk knows 12 × mango jam is coming today/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/stock-notes')[0]!.body).toEqual({
      product_id: 'p2',
      quantity: 12,
      expected_on: todayColombo(),
    });
    expect(await screen.findByRole('article', { name: 'Mango Jam, On its way' })).toBeInTheDocument();
  });

  it('cancels a note that is still on its way', async () => {
    const notes = [stockNote({ id: 'n7', status: 'SENT' })];
    const api = stockWorld(notes);
    renderApp('/stock');
    const note = await screen.findByRole('article', { name: 'Kithul Treacle, On its way' });
    await userEvent.click(within(note).getByRole('button', { name: /cancel this note/i }));
    await userEvent.click(within(note).getByRole('button', { name: /yes, cancel it/i }));
    expect(await screen.findByRole('article', { name: 'Kithul Treacle, Cancelled' })).toBeInTheDocument();
    expect(api.find('DELETE', '/seller/stock-notes/n7')).toHaveLength(1);
    expect(screen.getByText(/cancelled: 24 × kithul treacle/i)).toBeInTheDocument();
  });

  it('shows only the stock counts while notes are not ready', async () => {
    mockApi(
      worldHandler({
        products: PRODUCTS,
        extra: (call) =>
          call.path.startsWith('/seller/stock-notes') ? fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.') : undefined,
      })
    );
    renderApp('/stock');
    expect(await screen.findByRole('heading', { name: /stock at blynk now/i })).toBeInTheDocument();
    expect(await screen.findByText('Kithul Treacle')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /stock you are bringing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send stock to blynk|bring more/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why sending is off before approval', async () => {
    stockWorld([], { status: 'PENDING' });
    renderApp('/stock');
    expect(await screen.findByRole('button', { name: /send stock to blynk/i })).toBeDisabled();
    expect(screen.getByText(/once blynk has approved your shop/i)).toBeInTheDocument();
  });

  it('is in the main menu', async () => {
    stockWorld([]);
    renderApp('/products');
    await userEvent.click(await screen.findByRole('link', { name: /^stock$/i }));
    expect(await screen.findByRole('heading', { name: /^stock$/i })).toBeInTheDocument();
  });
});

describe('stock note chips', () => {
  it('On its way / Received N / Received N of M / Cancelled', () => {
    expect(noteChip(stockNote()).label).toBe('On its way');
    expect(noteChip(stockNote({ status: 'RECEIVED', received_quantity: 24 })).label).toBe('Received 24');
    expect(noteChip(stockNote({ status: 'RECEIVED', received_quantity: 20 })).label).toBe('Received 20 of 24');
    expect(noteChip(stockNote({ status: 'RECEIVED', received_quantity: null })).label).toBe('Received 24');
    expect(noteChip(stockNote({ status: 'CANCELLED' })).label).toBe('Cancelled');
  });
});
