import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok } from './mockApi';
import { product, renderApp, signInStoredSession, submission, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());

const EDIT_SUBMISSION = submission({
  id: 'sub-edit',
  kind: 'EDIT',
  product_id: 'p1',
  payload: { name: 'Kithul Treacle', category_id: 'c-jam', unit: '350 ml' },
  seller_price: 480,
});

describe('my products list', () => {
  it('shows the status chips, the price you set and the customer price, stock and units sold', async () => {
    mockApi(
      worldHandler({
        products: [
          product({ id: 'p1', name: 'Kithul Treacle', seller_price: 450, selling_price: 520, stock_on_hand: 12, units_sold: 30 }),
          product({ id: 'p2', name: 'Jaggery', is_active: false, stock_on_hand: null }),
          product({
            id: 'submission:r1',
            name: 'Mango Jam',
            live: false,
            selling_price: null,
            stock_on_hand: null,
            units_sold: 0,
            last_rejected: submission({ id: 'r1', status: 'REJECTED', reject_reason: 'The photo is blurry.' }),
          }),
        ],
      })
    );
    renderApp('/products');

    const live = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(live).getByText('Live')).toBeInTheDocument();
    expect(within(live).getByText('LKR 450.00')).toBeInTheDocument();
    expect(within(live).getByText('LKR 520.00')).toBeInTheDocument();
    expect(within(live).getByText('12')).toBeInTheDocument();
    expect(within(live).getByText('30')).toBeInTheDocument();

    const off = screen.getByRole('article', { name: 'Jaggery' });
    expect(within(off).getByText('Off')).toBeInTheDocument();
    expect(within(off).getByText('Not counted')).toBeInTheDocument();

    const rejected = screen.getByRole('article', { name: 'Mango Jam' });
    expect(within(rejected).getByText('Not approved')).toBeInTheDocument();
    expect(within(rejected).getByText(/the photo is blurry/i)).toBeInTheDocument();
    expect(within(rejected).getByText('Blynk sets it')).toBeInTheDocument();
    expect(within(rejected).getByRole('button', { name: /fix and send again/i })).toBeInTheDocument();
  });

  it('shows a friendly empty state', async () => {
    mockApi(worldHandler({ products: [] }));
    renderApp('/products');
    expect(await screen.findByText(/no products yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add your first product/i })).toBeInTheDocument();
  });

  it('shows an error with a way to try again', async () => {
    let first = true;
    mockApi((call) => {
      if (call.path === '/seller/products' && first) {
        first = false;
        return fail(500, 'INTERNAL', 'Something broke on our side.');
      }
      return worldHandler({ products: [product()] })(call);
    });
    renderApp('/products');
    expect(await screen.findByRole('alert')).toHaveTextContent(/something broke on our side/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('article', { name: 'Kithul Treacle' })).toBeInTheDocument();
  });

  it('shows a live product with a waiting change as Live plus "Change waiting for approval"', async () => {
    mockApi(worldHandler({ products: [product({ pending: EDIT_SUBMISSION })] }));
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByText('Live')).toBeInTheDocument();
    expect(within(card).getByText('Change waiting for approval')).toBeInTheDocument();
    expect(within(card).getByText(/the live product stays as it is until blynk approves it/i)).toBeInTheDocument();
  });

  it('withdraws a waiting change after one confirmation, then refreshes the list', async () => {
    let withdrawn = false;
    const api = mockApi((call) => {
      if (call.method === 'DELETE' && call.path === '/seller/submissions/sub-edit') {
        withdrawn = true;
        return ok({ submission: { ...EDIT_SUBMISSION, status: 'WITHDRAWN' } });
      }
      if (call.path === '/seller/products') {
        return ok({ products: [product({ pending: withdrawn ? null : EDIT_SUBMISSION })] });
      }
      return worldHandler()(call);
    });
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    await userEvent.click(within(card).getByRole('button', { name: /withdraw waiting change/i }));
    // Nothing is sent until the seller confirms.
    expect(api.find('DELETE', '/seller/submissions/sub-edit')).toHaveLength(0);
    await userEvent.click(within(card).getByRole('button', { name: /yes, withdraw it/i }));

    expect(await screen.findByText(/your waiting change was withdrawn/i)).toBeInTheDocument();
    expect(api.find('DELETE', '/seller/submissions/sub-edit')).toHaveLength(1);
    expect(screen.queryByText('Change waiting for approval')).not.toBeInTheDocument();
  });

  it('lets the seller change their mind about withdrawing', async () => {
    const api = mockApi(worldHandler({ products: [product({ pending: EDIT_SUBMISSION })] }));
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    await userEvent.click(within(card).getByRole('button', { name: /withdraw waiting change/i }));
    await userEvent.click(within(card).getByRole('button', { name: /keep it/i }));
    expect(within(card).getByRole('button', { name: /withdraw waiting change/i })).toBeInTheDocument();
    expect(api.find('DELETE', '/seller/submissions/sub-edit')).toHaveLength(0);
  });
});

describe('edit a product', () => {
  it('says the live product stays as it is, and sends only what changed as an EDIT submission', async () => {
    const api = mockApi((call) =>
      call.method === 'PATCH' && call.path === '/seller/products/p1'
        ? ok({ submission: EDIT_SUBMISSION })
        : worldHandler({ products: [product()] })(call)
    );
    renderApp('/products/p1/edit');

    expect(await screen.findByLabelText(/product name/i)).toHaveValue('Kithul Treacle');
    expect(screen.getByRole('heading', { name: /edit product/i })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/the live product stays exactly as it is until blynk approves your change/i);
    expect(screen.getByLabelText(/product name/i)).toHaveValue('Kithul Treacle');
    expect(screen.getByLabelText(/your price/i)).toHaveValue('450');
    expect(screen.getByText(/customers currently pay lkr 520\.00/i)).toBeInTheDocument();

    // Nothing changed yet: nothing to send.
    const send = screen.getByRole('button', { name: /send change to blynk for approval/i });
    expect(send).toBeDisabled();

    const price = screen.getByLabelText(/your price/i);
    await userEvent.clear(price);
    await userEvent.type(price, '480');
    await userEvent.click(send);

    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('PATCH', '/seller/products/p1')[0]!.body).toEqual({ seller_price: 480 });
    expect(await screen.findByText(/your change to "kithul treacle" was sent to blynk/i)).toBeInTheDocument();
    expect(screen.getByText(/stays as it is until blynk approves it/i)).toBeInTheDocument();
  });

  it('shows the edit as waiting on the list afterwards', async () => {
    let edited = false;
    mockApi((call) => {
      if (call.method === 'PATCH' && call.path === '/seller/products/p1') {
        edited = true;
        return ok({ submission: EDIT_SUBMISSION });
      }
      if (call.path === '/seller/products') return ok({ products: [product({ pending: edited ? EDIT_SUBMISSION : null })] });
      return worldHandler()(call);
    });
    renderApp('/products/p1/edit');
    const name = await screen.findByLabelText(/product name/i);
    await userEvent.type(name, ' Special');
    await userEvent.click(screen.getByRole('button', { name: /send change to blynk/i }));
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByText('Change waiting for approval')).toBeInTheDocument();
    expect(within(card).getByText('Live')).toBeInTheDocument();
  });

  it('starts from the waiting change and warns that sending again replaces it', async () => {
    const api = mockApi((call) =>
      call.method === 'PATCH' ? ok({ submission: EDIT_SUBMISSION }) : worldHandler({ products: [product({ pending: EDIT_SUBMISSION })] })(call)
    );
    renderApp('/products/p1/edit');
    expect(await screen.findByLabelText(/your price/i)).toHaveValue('480');
    expect(screen.getByText(/you already have a change waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/sending this replaces it/i)).toBeInTheDocument();

    const price = screen.getByLabelText(/your price/i);
    await userEvent.clear(price);
    await userEvent.type(price, '500');
    await userEvent.click(screen.getByRole('button', { name: /send change to blynk/i }));
    await screen.findByRole('heading', { name: /my products/i });
    // The earlier waiting price (480) is compared with the LIVE price (450), so the new one is sent.
    expect(api.find('PATCH', '/seller/products/p1')[0]!.body).toEqual({ seller_price: 500 });
  });

  it('can change the photo of a live product', async () => {
    const api = mockApi((call) => {
      if (call.path === '/seller/uploads/image') return ok({ url: 'https://media.blynk.lk/products/new.webp' });
      if (call.method === 'PATCH') return ok({ submission: EDIT_SUBMISSION });
      return worldHandler({ products: [product()] })(call);
    });
    renderApp('/products/p1/edit');
    await screen.findByLabelText(/product name/i);
    await userEvent.upload(
      screen.getByLabelText(/choose a photo from the gallery/i),
      new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    );
    await screen.findByRole('img', { name: /preview/i });
    const send = screen.getByRole('button', { name: /send change to blynk/i });
    await userEvent.click(send);
    await screen.findByRole('heading', { name: /my products/i });
    expect(api.find('PATCH', '/seller/products/p1')[0]!.body).toEqual({ image_url: 'https://media.blynk.lk/products/new.webp' });
  });

  it('says when the product cannot be found', async () => {
    mockApi(worldHandler({ products: [product()] }));
    renderApp('/products/nope/edit');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find that product/i);
  });
});
