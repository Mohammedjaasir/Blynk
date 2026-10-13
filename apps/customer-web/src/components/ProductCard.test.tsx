import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CartProvider, useCart } from '../cart/CartContext';
import { StoreContext } from '../store/StoreContext';
import ProductCard from './ProductCard';
import { milk, sugar, store } from '../test/fixtures';

function Count() { const c = useCart(); return <span data-testid="count">{c.count}</span>; }
const wrap = (ui: React.ReactNode, s = store) => render(
  <MemoryRouter><StoreContext.Provider value={s}><CartProvider>{ui}<Count /></CartProvider></StoreContext.Provider></MemoryRouter>
);

test('offer product shows struck regular price, highlighted offer, no Save line when switch off', () => {
  wrap(<ProductCard product={milk} />);
  expect(screen.getByText('LKR 540').tagName).toBe('S');
  expect(screen.getByText('LKR 513')).toHaveClass('hl');
  expect(screen.queryByText(/You save/)).toBeNull();
  expect(screen.getByText('5% OFF')).toBeInTheDocument();
});

test('Save line shows when show_offer_savings is true', () => {
  wrap(<ProductCard product={milk} />, { ...store, show_offer_savings: true });
  expect(screen.getByText('You save LKR 27')).toBeInTheDocument();
});

test('plus becomes a stepper; two fast taps give 2', async () => {
  wrap(<ProductCard product={sugar} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add White Sugar 1KG' }));
  await userEvent.click(screen.getByRole('button', { name: 'One more White Sugar 1KG' }));
  expect(screen.getByTestId('count')).toHaveTextContent('2');
  await userEvent.click(screen.getByRole('button', { name: 'One less White Sugar 1KG' }));
  expect(screen.getByTestId('count')).toHaveTextContent('1');
});

test('unavailable product shows Unavailable and no add button', () => {
  wrap(<ProductCard product={{ ...sugar, is_available: false }} />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
});
