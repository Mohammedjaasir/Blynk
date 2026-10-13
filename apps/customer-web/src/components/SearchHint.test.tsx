import { act, render, screen } from '@testing-library/react';
import SearchHint from './SearchHint';

afterEach(() => vi.useRealTimers());

test('default text when there are no products', () => {
  render(<SearchHint names={[]} />);
  expect(screen.getByText('Search groceries & essentials')).toBeInTheDocument();
});

test('cycles through the names every 2.4 s, one current line', () => {
  vi.useFakeTimers();
  render(<SearchHint names={['Milk', 'Sugar']} />);
  expect(screen.getByText("Search for 'Milk'")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(2400); });
  expect(screen.getByText("Search for 'Sugar'")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.queryByText("Search for 'Milk'")).toBeNull();
});
