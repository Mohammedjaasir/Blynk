import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider, SESSION_ENDED_MESSAGE } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { ApiError, apiRequest, tokenStore } from '../api/client';
import { Login } from '../pages/Login';
import { ProductForm } from '../pages/ProductForm';
import { errorMessage, fieldErrors, splitServerErrors } from '../lib/apiErrors';
import { imagesToDelete } from '../lib/imageCleanup';
import { TOO_LARGE_AFTER_RESIZE_MESSAGE } from '../lib/image';
import { fail, mockApi, ok } from './mockApi';

/**
 * Fixes 1, 2, 3 and 8: staff SMS sign-in never creates an account, an ended
 * session goes back to sign-in (but an unreachable API does not sign anyone
 * out), images are deleted only after a successful save, and the server's
 * per-field validation details reach the form.
 */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------- 1. SMS sign-in
describe('staff sign-in by SMS code', () => {
  beforeEach(() => tokenStore.clear());

  it('sends create_account:false and explains an unknown number', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/auth/otp/request') return ok({ dev_otp: '123456' });
      if (c.path === '/auth/otp/verify') return fail(404, 'ACCOUNT_NOT_FOUND', 'No Blynk account uses this number.');
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <Login />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(screen.getByLabelText(/Mobile number/), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByText(/No Blynk account uses this number\./)).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')[0]?.body).toEqual({ phone: '0771234567', otp: '123456', create_account: false });
    // Back to the number step; nothing was stored.
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

// ------------------------------------------------------------- 2. session end
describe('session expiry', () => {
  function renderApp(route: string) {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
  }

  it('a refused refresh signs out to the sign-in page with "Your session has ended"', async () => {
    tokenStore.save('access', 'refresh');
    let expired = false;
    mockApi((c) => {
      if (c.path === '/auth/me') return ok(ADMIN);
      if (c.path === '/auth/refresh') return fail(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token.');
      if (c.path === '/admin/coupons') {
        // The first read works; the next one finds the access token expired.
        if (!expired) {
          expired = true;
          return ok({ coupons: [] });
        }
        return fail(401, 'UNAUTHORIZED', 'Token expired');
      }
      return ok({});
    });
    renderApp('/coupons');
    await screen.findByText('No coupons yet');
    // Something on the page reads again with the now-expired token.
    await act(async () => {
      await expect(apiRequest('/admin/coupons')).rejects.toMatchObject({ status: 401 });
    });

    expect(await screen.findByText(SESSION_ENDED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it('a refresh that cannot reach the API keeps the session (no sign-out)', async () => {
    tokenStore.save('expired-access', 'refresh-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
        } as Response;
      })
    );

    const error = await apiRequest('/admin/products').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NETWORK' });
    expect(tokenStore.access).toBe('expired-access');
    expect(tokenStore.refresh).toBe('refresh-1');
  });

  it('a 5xx from the refresh is not a refusal either', async () => {
    tokenStore.save('expired-access', 'refresh-1');
    mockApi((c) => (c.path === '/auth/refresh' ? fail(503, 'UNAVAILABLE') : fail(401, 'UNAUTHORIZED')));
    await expect(apiRequest('/admin/products')).rejects.toMatchObject({ code: 'REFRESH_UNAVAILABLE' });
    expect(tokenStore.refresh).toBe('refresh-1');
  });

  it('an unreachable API at start-up keeps the stored session and offers a retry', async () => {
    tokenStore.save('access', 'refresh');
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (!online) throw new TypeError('Failed to fetch');
        const url = String(input);
        const data = url.endsWith('/auth/me') ? ADMIN : { coupons: [] };
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) } as Response;
      })
    );
    renderApp('/coupons');
    expect(await screen.findByText(/Could not reach the Blynk API/)).toBeInTheDocument();
    expect(tokenStore.access).toBe('access');

    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No coupons yet')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------- 3 + 8. product form
const CATEGORY = { id: 'c1', name: 'Dairy', slug: 'dairy', description: null, image_url: null, display_order: 0, is_active: true };
const OLD_IMAGE = 'https://media.blynk.lk/products/old.webp';
const NEW_IMAGE = 'https://media.blynk.lk/products/new.webp';
const PRODUCT = {
  id: 'p1',
  category_id: 'c1',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'kotmale-fresh-milk-1l',
  sku: 'KOT-MILK-1L',
  barcode: null,
  unit: 'bottle',
  pack_size: '1L',
  description: null,
  image_url: OLD_IMAGE,
  purchase_cost: 430,
  custom_markup_percent: null,
  effective_markup_percent: 12,
  calculated_selling_price: 481.6,
  is_available: true,
  is_active: true,
};

function renderProductForm(handler: Parameters<typeof mockApi>[0]) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: [CATEGORY] });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product: PRODUCT });
    if (c.method === 'DELETE' && c.path === '/admin/media') return ok({ deleted: true });
    return handler(c);
  });
  const view = render(
    <MemoryRouter initialEntries={['/products/p1']}>
      <ToastProvider>
        <Routes>
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products" element={<p>Product list</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
  return { api, view };
}

const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

describe('product images are deleted only after a successful save', () => {
  beforeEach(() => {
    // jsdom has no object URLs; the uploader previews the picked file with one.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  });

  it('Remove changes only the field; saving deletes the old file', async () => {
    const user = userEvent.setup();
    const { api } = renderProductForm((c) => (c.method === 'PATCH' ? ok({ product: { ...PRODUCT, image_url: null } }) : undefined));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({ image_url: null });
    expect(api.find('DELETE', '/admin/media').map((c) => c.body)).toEqual([{ url: OLD_IMAGE }]);
  });

  it('a failed save deletes nothing, and neither does Cancel', async () => {
    const user = userEvent.setup();
    const { api } = renderProductForm((c) => (c.method === 'PATCH' ? fail(500, 'INTERNAL_SERVER_ERROR', 'Boom') : undefined));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
  });

  it('a replaced image: the new one is saved, then the old one is deleted', async () => {
    const user = userEvent.setup();
    const { api, view } = renderProductForm((c) => {
      if (c.method === 'POST' && c.path === '/admin/media') return ok({ media: { key: 'products/new.webp', url: NEW_IMAGE } });
      if (c.method === 'PATCH') return ok({ product: { ...PRODUCT, image_url: NEW_IMAGE } });
      return undefined;
    });
    await screen.findByRole('button', { name: 'Replace image' });
    fireEvent.change(fileInput(view.container), {
      target: { files: [new File([new Uint8Array(1024)], 'milk.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(api.find('POST', '/admin/media')).toHaveLength(1));
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({ image_url: NEW_IMAGE });
    expect(api.find('DELETE', '/admin/media').map((c) => c.body)).toEqual([{ url: OLD_IMAGE }]);
  });

  it('refuses a file still over 2 MB after resizing, before uploading it', async () => {
    const { api, view } = renderProductForm(() => undefined);
    await screen.findByRole('button', { name: 'Replace image' });
    fireEvent.change(fileInput(view.container), {
      target: { files: [new File([new Uint8Array(3 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByText(TOO_LARGE_AFTER_RESIZE_MESSAGE)).toBeInTheDocument();
    expect(api.find('POST', '/admin/media')).toHaveLength(0);
  });

  it("explains the API's 413 FILE_TOO_LARGE", async () => {
    const { view } = renderProductForm((c) =>
      c.method === 'POST' && c.path === '/admin/media' ? fail(413, 'FILE_TOO_LARGE', 'Images must be 2 MB or smaller.') : undefined
    );
    await screen.findByRole('button', { name: 'Replace image' });
    fireEvent.change(fileInput(view.container), {
      target: { files: [new File([new Uint8Array(1024)], 'milk.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByText('Images must be 2 MB or smaller.')).toBeInTheDocument();
  });

  it('imagesToDelete keeps what the saved record uses', () => {
    expect(imagesToDelete(['a', null], ['b'], ['b', 'c'])).toEqual(['a', 'c']);
    expect(imagesToDelete(['a'], ['a'], [])).toEqual([]);
    expect(imagesToDelete([null, undefined], [null], [])).toEqual([]);
  });
});

describe('product form limits and server field errors', () => {
  it('checks markup 0-999.99 and cost up to 99,999,999.99 before sending', async () => {
    const user = userEvent.setup();
    const { api } = renderProductForm(() => undefined);
    const cost = await screen.findByLabelText('Purchase cost (LKR)');
    await user.clear(cost);
    await user.type(cost, '100000000');
    await user.type(screen.getByLabelText(/Custom markup %/), '1000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Purchase cost can be at most LKR 99,999,999.99')).toBeInTheDocument();
    expect(screen.getByText('Markup must be between 0 and 999.99')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);

    await user.clear(screen.getByLabelText(/Custom markup %/));
    await user.type(screen.getByLabelText(/Custom markup %/), '999.99');
    await user.clear(cost);
    await user.type(cost, '99999999.99');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
  });

  it('shows the API validation details per field, not "Request validation failed"', async () => {
    const user = userEvent.setup();
    renderProductForm((c) =>
      c.method === 'PATCH'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [
            { field: 'purchase_cost', message: 'Purchase cost cannot exceed 99999999.99', rule: 'too_big' },
            { field: 'barcode', message: 'Barcode is already used', rule: 'custom' },
          ])
        : undefined
    );
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Purchase cost cannot exceed 99999999.99')).toBeInTheDocument();
    expect(screen.getByText('Barcode: Barcode is already used')).toBeInTheDocument();
    expect(screen.queryByText('Request validation failed')).toBeNull();
  });
});

describe('the shared error helper', () => {
  const validation = new ApiError('Request validation failed', 400, 'VALIDATION_ERROR', [
    { field: 'usage_limit', message: 'Must be at least 1' },
    { path: ['ends_at'], message: 'The end must be after the start' },
  ]);

  it('lists validation details by field', () => {
    expect(errorMessage(validation, 'x')).toBe('Usage limit: Must be at least 1 Ends at: The end must be after the start');
    expect(fieldErrors(validation)).toEqual({ usage_limit: 'Must be at least 1', ends_at: 'The end must be after the start' });
  });

  it('leaves out fields shown inline', () => {
    const { inline, message } = splitServerErrors(validation, ['usage_limit'], 'x');
    expect(inline).toEqual({ usage_limit: 'Must be at least 1' });
    expect(message).toBe('Ends at: The end must be after the start');
  });

  it('maps upload size refusals and falls back sensibly', () => {
    expect(errorMessage(new ApiError('Payload too large', 413, 'PAYLOAD_TOO_LARGE'), 'x')).toBe('Images must be 2 MB or smaller.');
    expect(errorMessage(new ApiError('Nope', 409, 'CONFLICT'), 'x')).toBe('Nope');
    expect(errorMessage('weird', 'Could not save.')).toBe('Could not save.');
  });
});
