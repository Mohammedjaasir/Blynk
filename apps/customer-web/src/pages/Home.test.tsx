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

const groups = (cats = [dairy]) => vi.spyOn(catalog, 'getHomeGroups').mockResolvedValue({ groups: [{ id: null, name: 'More', sort_order: 0, categories: cats }] });

test('I1: a catalogue refresh with a new price updates the cart bar total', async () => {
  const { saveCart, setQuantity } = await import('../cart/cartStore');
  const { default: CartBar } = await import('../components/CartBar');
  const { startCatalogLive } = await import('../lib/catalogLive');
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  let fire: () => void = () => {};
  vi.spyOn(await import('../lib/catalogLive'), 'startCatalogLive').mockImplementation((cb: () => void) => { fire = cb; return () => {}; });
  void startCatalogLive;
  const gp = vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  groups(); vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  render(<MemoryRouter><StoreContext.Provider value={store}><CartProvider><Home /><CartBar /></CartProvider></StoreContext.Provider></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('LKR 253')).toBeInTheDocument());
  gp.mockResolvedValue({ products: [{ ...sugar, selling_price: 300 }], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  fire();
  await waitFor(() => expect(screen.getAllByText('LKR 300').length).toBeGreaterThan(0));
  expect(screen.queryByText('LKR 253')).not.toBeInTheDocument();
});

test('I2: a product in a child category counts toward its top-level tile and aisle', async () => {
  const eggs = { ...dairy, id: 'c-eggs', name: 'Eggs', slug: 'eggs', parent_id: 'c-dairy', offer_percent: null };
  const eggPack = { ...sugar, id: 'p-egg', name: 'Eggs 10 pack', category_id: 'c-eggs', selling_price: 700 };
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [eggPack], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  groups(); vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy, eggs] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  mount();
  await waitFor(() => expect(screen.getByText('FROM LKR 700')).toBeInTheDocument());
  expect(screen.queryByText('SOON')).not.toBeInTheDocument();
  expect(screen.getByText(/1 items/)).toBeInTheDocument();
});

test('I3: radius and hours come from the store, and hide when missing', async () => {
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  groups(); vi.spyOn(catalog, 'getCategories').mockResolvedValue({ categories: [dairy] });
  vi.spyOn(catalog, 'getPromotions').mockResolvedValue({ promotions: [] });
  const custom = { ...store, radius_km: 6, delivery_hours: { start: '07:00', end: '22:30', timezone: 'Asia/Colombo' } };
  render(<MemoryRouter><StoreContext.Provider value={custom}><CartProvider><Home /></CartProvider></StoreContext.Provider></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Groceries delivered within 6 km')).toBeInTheDocument());
  expect(screen.getByText(/7 AM – 10:30 PM/)).toBeInTheDocument();
  expect(screen.queryByText(/8 AM/)).not.toBeInTheDocument();
});
