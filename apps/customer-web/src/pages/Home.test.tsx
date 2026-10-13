import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { ApiError } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Home from './Home';
import { milk, sugar, dairy, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter><StoreContext.Provider value={store}><CartProvider><Home /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows skeleton, then rails built from the live catalogue', async () => {
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk, sugar], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
  vi.spyOn(catalog, 'getHomeGroups').mockResolvedValue({ groups: [{ id: null, name: 'More', sort_order: 0, categories: [dairy] }] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  mount();
  expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Under LKR 300')).toBeInTheDocument());
  expect(screen.getByText(/Groceries starting at/)).toBeInTheDocument();
  expect(screen.getAllByText('White Sugar 1KG').length).toBeGreaterThan(0);
  expect(screen.getByText('5% LOWER PRICES')).toBeInTheDocument();
  expect(screen.getByText('FROM LKR 513')).toBeInTheDocument();
});

test('network failure shows error with Try again, retry recovers', async () => {
  const gp = vi.spyOn(catalog, 'getProducts').mockRejectedValueOnce(new ApiError("We couldn't reach Blynk.", 0, 'NETWORK_ERROR'))
    .mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  vi.spyOn(catalog, 'getHomeGroups').mockResolvedValue({ groups: [] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  mount();
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  screen.getByRole('button', { name: 'Try again' }).click();
  await waitFor(() => expect(screen.getByText('Under LKR 300')).toBeInTheDocument());
  expect(gp).toHaveBeenCalledTimes(2);
});
