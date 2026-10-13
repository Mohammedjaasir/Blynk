import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../api/client';
import * as catalog from '../api/catalog';
import { CartProvider } from '../cart/CartContext';
import { saveCart, setQuantity } from '../cart/cartStore';
import { StoreContext } from '../store/StoreContext';
import Cart from './Cart';
import { milk, sugar, store } from '../test/fixtures';

const mount = (s = store) => render(<MemoryRouter><StoreContext.Provider value={s}><CartProvider><Cart /></CartProvider></StoreContext.Provider></MemoryRouter>);
afterEach(() => vi.restoreAllMocks());

test('empty cart', () => {
  mount();
  expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
});

const saving = { ...store, show_offer_savings: true };

test('shows lines, savings, free delivery and the guest footer', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 2), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk, sugar], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
  mount(saving);
  expect(screen.getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  expect(screen.getByText('LKR 54 saved with offer prices')).toBeInTheDocument();
  expect(screen.getByText('FREE · first 2 deliveries')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Proceed with phone number' })).toBeInTheDocument();
});

test('distance fee without free deliveries says calculated at checkout', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  mount({ ...store, new_customer_free_deliveries: { enabled: false, count: 0, since: store.new_customer_free_deliveries.since } });
  expect(screen.getByText('Calculated at checkout')).toBeInTheDocument();
});

test('a product that became unavailable is marked and left out of the total', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockImplementation(async () => ({ products: [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }));
  mount();
  await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
  expect(screen.getByTestId('cart-total')).toHaveTextContent('LKR 513');
  await userEvent.click(screen.getByRole('button', { name: 'Remove White Sugar 1KG' }));
  expect(screen.queryByText('White Sugar 1KG')).toBeNull();
});

test('savings card and struck item total only show when show_offer_savings is on', () => {
  saveCart(setQuantity({ lines: [] }, milk, 2));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  const { unmount } = mount(store);
  expect(screen.queryByText(/saved with offer prices/)).toBeNull();
  expect((screen.getByText('Item total').nextSibling as HTMLElement).querySelector('s')).toBeNull();
  expect(screen.getByText('FREE · first 2 deliveries')).toBeInTheDocument();
  unmount();
  mount(saving);
  expect(screen.getByText('LKR 54 saved with offer prices')).toBeInTheDocument();
  expect((screen.getByText('Item total').nextSibling as HTMLElement).querySelector('s')).not.toBeNull();
});

test('reconcile fetches every catalogue page, so later-page products stay available', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  const gp = vi.spyOn(catalog, 'getProducts').mockImplementation(async (q) => q?.page === 2
    ? { products: [sugar], pagination: { page: 2, limit: 100, total: 2, total_pages: 2 } }
    : { products: [milk], pagination: { page: 1, limit: 100, total: 2, total_pages: 2 } });
  mount();
  await waitFor(() => expect(gp).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('LKR 253'));
  expect(screen.queryByText('Unavailable')).toBeNull();
});

test('a quantity change made while the refresh is in flight is kept', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  let release!: (v: { products: typeof sugar[]; pagination: { page: number; limit: number; total: number; total_pages: number } }) => void;
  vi.spyOn(catalog, 'getProducts').mockReturnValue(new Promise((r) => { release = r; }));
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'One more White Sugar 1KG' }));
  release({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('LKR 506'));
});

test('a failed refresh shows a notice and keeps the stored lines', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockRejectedValue(new ApiError("We couldn't reach Blynk.", 0, 'NETWORK_ERROR'));
  mount();
  await waitFor(() => expect(screen.getByText("Couldn't refresh prices. Check your connection.")).toBeInTheDocument());
  expect(screen.getByText('White Sugar 1KG')).toBeInTheDocument();
});

test('Back goes to the shop when there is no history', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
  render(<MemoryRouter initialEntries={['/cart']}><StoreContext.Provider value={store}><CartProvider>
    <Routes><Route path="/cart" element={<Cart />} /><Route path="/" element={<div>Shop home</div>} /></Routes>
  </CartProvider></StoreContext.Provider></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('Shop home')).toBeInTheDocument();
});
