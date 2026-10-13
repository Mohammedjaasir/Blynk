import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

test('shows lines, savings, free delivery and the guest footer', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 2), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [milk, sugar], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
  mount();
  expect(screen.getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  expect(screen.getByText('LKR 54 saved with offer prices')).toBeInTheDocument();
  expect(screen.getByText('FREE · first 2 orders')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Proceed with Phone Number' })).toBeInTheDocument();
});

test('distance fee without free deliveries says calculated at checkout', async () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockResolvedValue({ products: [sugar], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
  mount({ ...store, new_customer_free_deliveries: { enabled: false, count: 0, since: store.new_customer_free_deliveries.since } });
  expect(screen.getByText('Calculated at checkout')).toBeInTheDocument();
});

test('a product that became unavailable is marked and left out of the total', async () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1));
  vi.spyOn(catalog, 'getProducts').mockImplementation(async (q) => ({ products: q?.category_slug === undefined ? [milk] : [milk], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }));
  mount();
  await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
  expect(screen.getByTestId('cart-total')).toHaveTextContent('LKR 513');
  await userEvent.click(screen.getByRole('button', { name: 'Remove White Sugar 1KG' }));
  expect(screen.queryByText('White Sugar 1KG')).toBeNull();
});
