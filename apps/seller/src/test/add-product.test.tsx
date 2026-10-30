import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok } from './mockApi';
import { renderApp, signInStoredSession, submission, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());

const PHOTO_URL = 'https://media.blynk.lk/products/mango-jam.webp';

function photo(name = 'jam.jpg', type = 'image/jpeg') {
  return new File(['pixels'], name, { type });
}

async function openForm() {
  renderApp('/products/new');
  await screen.findByRole('heading', { name: /add a product/i });
  await screen.findByRole('option', { name: 'Rice' });
}

/** Pick a photo and wait until it is uploaded (the send button waits for it). */
async function addPhoto() {
  await userEvent.upload(screen.getByLabelText(/choose a photo from the gallery/i), photo());
  await screen.findByRole('img', { name: /product photo preview/i });
  await waitFor(() => expect(screen.getByRole('button', { name: /send to blynk for approval/i })).toBeEnabled());
}

const uploadOk = (call: { method: string; path: string }) =>
  call.method === 'POST' && call.path === '/seller/uploads/image' ? ok({ url: PHOTO_URL }) : undefined;

async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/product name/i), 'Mango Jam');
  await userEvent.selectOptions(screen.getByLabelText(/category/i), 'c-rice');
  await userEvent.type(screen.getByLabelText(/^unit/i), '250 g');
  await userEvent.type(screen.getByLabelText(/your price/i), '1,250.50');
}

describe('add a product', () => {
  it('lists sub-categories under their main category', async () => {
    mockApi(worldHandler());
    await openForm();
    const select = screen.getByLabelText(/category/i);
    const group = within(select).getByRole('group', { name: 'Pantry' });
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual(['Rice', 'Spreads']);
    // A main category without sub-categories is a choice on its own.
    expect(within(select).getByRole('option', { name: 'Fruit' })).toBeInTheDocument();
  });

  it('explains that Blynk reviews the product and sets the customer price', async () => {
    mockApi(worldHandler());
    await openForm();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/blynk checks every product before it goes live/i);
    expect(note).toHaveTextContent(/blynk sets the price customers pay/i);
  });

  it('uploads the photo, shows a preview, and sends everything to Blynk for approval', async () => {
    const api = mockApi((call) => {
      if (call.method === 'POST' && call.path === '/seller/uploads/image') return ok({ url: PHOTO_URL });
      if (call.method === 'POST' && call.path === '/seller/products') return { status: 201, data: { submission: submission() } };
      return worldHandler()(call);
    });
    await openForm();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/pack size/i), 'pack of 6');
    await userEvent.type(screen.getByLabelText(/description/i), 'Sweet and thick.');
    await userEvent.type(screen.getByLabelText(/barcode/i), '4791234567890');

    await userEvent.upload(screen.getByLabelText(/choose a photo from the gallery/i), photo());
    expect(await screen.findByRole('img', { name: /product photo preview/i })).toBeInTheDocument();
    await waitFor(() => expect(api.find('POST', '/seller/uploads/image')).toHaveLength(1));
    const sent = api.find('POST', '/seller/uploads/image')[0]!.body as FormData;
    expect(sent.get('file')).toBeInstanceOf(File);
    expect((sent.get('file') as File).name).toBe('jam.jpg');

    // The send button waits for the upload to finish.
    const send = screen.getByRole('button', { name: /send to blynk for approval/i });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);

    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('POST', '/seller/products')[0]!.body).toEqual({
      name: 'Mango Jam',
      category_id: 'c-rice',
      unit: '250 g',
      pack_size: 'pack of 6',
      description: 'Sweet and thick.',
      barcode: '4791234567890',
      image_url: PHOTO_URL,
      seller_price: 1250.5,
    });
    expect(await screen.findByText(/blynk will check "mango jam"/i)).toBeInTheDocument();
  });

  it('sends empty optional boxes as nothing (only the photo is kept)', async () => {
    const api = mockApi(
      (call) =>
        uploadOk(call) ??
        (call.method === 'POST' && call.path === '/seller/products'
          ? { status: 201, data: { submission: submission() } }
          : worldHandler()(call))
    );
    await openForm();
    await fillRequired();
    await addPhoto();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    await screen.findByRole('heading', { name: /my products/i });
    expect(api.find('POST', '/seller/products')[0]!.body).toEqual({
      name: 'Mango Jam',
      category_id: 'c-rice',
      unit: '250 g',
      pack_size: null,
      description: null,
      barcode: null,
      image_url: PHOTO_URL,
      seller_price: 1250.5,
    });
  });

  it('cannot be sent without a photo: says "Add a photo of your product." and sends nothing', async () => {
    const api = mockApi(worldHandler());
    await openForm();
    await fillRequired();
    expect(screen.getByRole('heading', { name: /^photo/i })).toHaveTextContent(/\(required\)/i);
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    expect(await screen.findByText('Add a photo of your product.')).toBeInTheDocument();
    expect(api.find('POST', '/seller/products')).toHaveLength(0);
  });

  it('clears the photo message once a photo is added', async () => {
    mockApi((call) => uploadOk(call) ?? worldHandler()(call));
    await openForm();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    await screen.findByText('Add a photo of your product.');
    await addPhoto();
    expect(screen.queryByText('Add a photo of your product.')).not.toBeInTheDocument();
  });

  it('shows the API refusal IMAGE_REQUIRED under the photo', async () => {
    mockApi(
      (call) =>
        uploadOk(call) ??
        (call.method === 'POST' && call.path === '/seller/products'
          ? fail(400, 'IMAGE_REQUIRED', 'Add a photo of the product.')
          : worldHandler()(call))
    );
    await openForm();
    await fillRequired();
    await addPhoto();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    expect(await screen.findAllByText('Add a photo of your product.')).not.toHaveLength(0);
  });

  it('says in plain words what is missing and sends nothing', async () => {
    const api = mockApi(worldHandler());
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    expect(await screen.findByText(/enter the product name/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a category/i, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/enter the unit/i)).toBeInTheDocument();
    expect(screen.getByText(/enter the price you want/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/product name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(api.find('POST', '/seller/products')).toHaveLength(0);
  });

  it('rejects a price that is not a number, zero, or too high', async () => {
    mockApi(worldHandler());
    await openForm();
    await fillRequired();
    const price = screen.getByLabelText(/your price/i);
    const send = screen.getByRole('button', { name: /send to blynk for approval/i });

    await userEvent.clear(price);
    await userEvent.type(price, 'abc');
    await userEvent.click(send);
    expect(await screen.findByText(/enter the price as a number/i)).toBeInTheDocument();

    await userEvent.clear(price);
    await userEvent.type(price, '0');
    await userEvent.click(send);
    expect(await screen.findByText(/price must be more than 0/i)).toBeInTheDocument();

    await userEvent.clear(price);
    await userEvent.type(price, '1000001');
    await userEvent.click(send);
    expect(await screen.findByText(/cannot be more than lkr 1,000,000/i)).toBeInTheDocument();
  });

  it('shows the server\'s complaint next to the box it is about', async () => {
    mockApi(
      (call) =>
        uploadOk(call) ??
        (call.method === 'POST' && call.path === '/seller/products'
          ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [
              { field: 'seller_price', message: 'Your price can have at most 2 decimals.' },
            ])
          : worldHandler()(call))
    );
    await openForm();
    await fillRequired();
    await addPhoto();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    expect(await screen.findByText(/at most 2 decimals/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your price/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so when the shop is not approved (the API refused)', async () => {
    mockApi(
      (call) =>
        uploadOk(call) ??
        (call.method === 'POST' && call.path === '/seller/products'
          ? fail(403, 'SELLER_NOT_APPROVED', 'Your seller account is not approved.')
          : worldHandler()(call))
    );
    await openForm();
    await fillRequired();
    await addPhoto();
    await userEvent.click(screen.getByRole('button', { name: /send to blynk for approval/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/has not approved your shop yet/i);
  });

  it('explains a failed upload and lets the seller try again', async () => {
    let attempt = 0;
    mockApi((call) => {
      if (call.path === '/seller/uploads/image') {
        attempt += 1;
        return attempt === 1 ? fail(413, 'FILE_TOO_LARGE', 'too big') : ok({ url: PHOTO_URL });
      }
      return worldHandler()(call);
    });
    await openForm();
    const input = screen.getByLabelText(/choose a photo from the gallery/i);
    await userEvent.upload(input, photo());
    expect(await screen.findByText(/photos must be 5 mb or smaller/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument();

    await userEvent.upload(input, photo('again.jpg'));
    expect(await screen.findByRole('img', { name: /preview/i })).toBeInTheDocument();
    expect(screen.queryByText(/photos must be 5 mb/i)).not.toBeInTheDocument();
  });

  it('refuses a file that is not a photo before uploading it', async () => {
    const api = mockApi(worldHandler());
    renderApp('/products/new');
    await screen.findByRole('option', { name: 'Rice' });
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText(/choose a photo from the gallery/i), photo('notes.pdf', 'application/pdf'));
    expect(await screen.findByText(/choose a jpeg, png or webp photo/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/uploads/image')).toHaveLength(0);
  });

  it('offers the camera on phones', async () => {
    mockApi(worldHandler());
    await openForm();
    expect(screen.getByRole('button', { name: /take a photo/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/take a photo with the camera/i)).toHaveAttribute('capture', 'environment');
  });

  it('lets the seller remove the photo again', async () => {
    mockApi((call) => (call.path === '/seller/uploads/image' ? ok({ url: PHOTO_URL }) : worldHandler()(call)));
    await openForm();
    await userEvent.upload(screen.getByLabelText(/choose a photo from the gallery/i), photo());
    await screen.findByRole('img', { name: /preview/i });
    await userEvent.click(await screen.findByRole('button', { name: /remove photo/i }));
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no photo yet/i)).toBeInTheDocument();
  });
});
