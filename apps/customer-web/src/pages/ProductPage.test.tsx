import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { ApiError } from '../api/client';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import ProductPage from './ProductPage';
import { milk, store } from '../test/fixtures';

const mount = () => render(<MemoryRouter initialEntries={['/p/p-milk']}><StoreContext.Provider value={store}><CartProvider>
  <Routes><Route path="/p/:id" element={<ProductPage />} /></Routes></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows product details and an Add button', async () => {
  vi.spyOn(catalog, 'getProduct').mockResolvedValue({ product: { ...milk, offer_ends_at: '2026-10-20T18:29:59.000Z' } });
  mount();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Kotmale Fresh Milk 1L' })).toBeInTheDocument());
  expect(screen.getByText('Available')).toBeInTheDocument();
  expect(screen.getByText(/Offer ends/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument();
});

test('404 shows product no longer available', async () => {
  vi.spyOn(catalog, 'getProduct').mockRejectedValue(new ApiError('Not found', 404, 'PRODUCT_NOT_FOUND'));
  mount();
  await waitFor(() => expect(screen.getByText('Product no longer available')).toBeInTheDocument());
});
