import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
