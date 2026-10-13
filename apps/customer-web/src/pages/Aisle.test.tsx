import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import Aisle from './Aisle';
import { milk, dairy, store } from '../test/fixtures';

const mount = (slug: string) => render(
  <MemoryRouter initialEntries={[`/aisle/${slug}`]}><StoreContext.Provider value={store}><CartProvider>
    <Routes><Route path="/aisle/:slug" element={<Aisle />} /></Routes>
  </CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('shows the category with its offer line and products', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  const gp = vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  mount('dairy-eggs');
  await waitFor(() => expect(screen.getByText('Dairy & Eggs at Blynk')).toBeInTheDocument());
  expect(screen.getByText('5% LOWER PRICES ON EVERYTHING HERE')).toBeInTheDocument();
  expect(screen.getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  expect(gp).toHaveBeenCalledWith({ category_slug: 'dairy-eggs', page: 1, limit: 100 });
});

test('an empty aisle says Coming soon', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [{ ...dairy, slug: 'bakery', name: 'Bakery', offer_percent: null }] });
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 0 } });
  mount('bakery');
  await waitFor(() => expect(screen.getByText('Coming soon to Blynk')).toBeInTheDocument());
});

test('an unknown slug shows not found', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 0 } });
  mount('nope');
  await waitFor(() => expect(screen.getByText("This aisle isn't available")).toBeInTheDocument());
});

test('aisle header uses store hours and the server total', async () => {
  vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 100, total: 130, total_pages: 2 } });
  mount('dairy-eggs');
  await waitFor(() => expect(screen.getByText('130 items')).toBeInTheDocument());
  expect(screen.getByText('8 AM – 9 PM')).toBeInTheDocument();
});
