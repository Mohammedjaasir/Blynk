import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CartProvider } from '../cart/CartContext';
import { saveCart, setQuantity } from '../cart/cartStore';
import { StoreContext } from '../store/StoreContext';
import CartBar from './CartBar';
import { milk, sugar, store } from '../test/fixtures';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><StoreContext.Provider value={store}><CartProvider><CartBar /></CartProvider></StoreContext.Provider></MemoryRouter>);

test('shows sentence-case summary on the shop', () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  at('/');
  expect(screen.getByText('1 item')).toBeInTheDocument();
  expect(screen.getByText('View cart')).toBeInTheDocument();
  expect(screen.getByText(/Yay!/)).toBeInTheDocument();
});

test('plural items', () => {
  saveCart(setQuantity(setQuantity({ lines: [] }, sugar, 1), milk, 2));
  at('/aisle/x');
  expect(screen.getByText('3 items')).toBeInTheDocument();
});

test('hidden on the product page, which has its own View cart', () => {
  saveCart(setQuantity({ lines: [] }, sugar, 1));
  at('/p/p-sugar');
  expect(screen.queryByText('View cart')).toBeNull();
});
