import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../api/client';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Search from './Search';
import { milk, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter><StoreContext.Provider value={store}><CartProvider><Search /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('debounced search shows results and remembers the query', async () => {
  const gp = vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 40, total: 1, total_pages: 1 } });
  mount();
  await userEvent.type(screen.getByRole('searchbox'), 'milk');
  await waitFor(() => expect(screen.getByText('1 result')).toBeInTheDocument());
  expect(gp).toHaveBeenLastCalledWith({ search: 'milk', category_slug: undefined, page: 1, limit: 40 });
  expect(JSON.parse(localStorage.getItem('blynk.web.recentSearches')!)).toEqual(['milk']);
});

test('no results message', async () => {
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 40, total: 0, total_pages: 0 } });
  mount();
  await userEvent.type(screen.getByRole('searchbox'), 'zzz');
  await waitFor(() => expect(screen.getByText('No results for "zzz"')).toBeInTheDocument());
});

test('a failed request shows the offline error with Try again, not No results', async () => {
  const gp = vi.spyOn(catalog, 'getProducts').mockRejectedValueOnce(new ApiError("We couldn't reach Blynk.", 0, 'NETWORK_ERROR'))
    .mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 40, total: 1, total_pages: 1 } });
  mount();
  await userEvent.type(screen.getByRole('searchbox'), 'milk');
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByText("You're offline")).toBeInTheDocument();
  expect(screen.queryByText(/No results/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByText('1 result')).toBeInTheDocument());
  expect(gp).toHaveBeenCalledTimes(2);
});

test('a slow older response cannot overwrite newer results', async () => {
  type R = Awaited<ReturnType<typeof catalog.getProducts>>;
  const slow: { resolve?: (r: R) => void } = {};
  vi.spyOn(catalog, 'getProducts').mockImplementation((q) => q?.search === 'mi'
    ? new Promise<R>((r) => { slow.resolve = r; })
    : Promise.resolve({ products: [milk], pagination: { page: 1, limit: 40, total: 1, total_pages: 1 } }));
  mount();
  const box = screen.getByRole('searchbox');
  await userEvent.type(box, 'mi');
  await waitFor(() => expect(slow.resolve).toBeDefined());
  await userEvent.type(box, 'lk');
  await waitFor(() => expect(screen.getByText('1 result')).toBeInTheDocument());
  slow.resolve!({ products: [], pagination: { page: 1, limit: 40, total: 0, total_pages: 0 } });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByText('1 result')).toBeInTheDocument();
  expect(screen.queryByText(/No results/)).toBeNull();
});
