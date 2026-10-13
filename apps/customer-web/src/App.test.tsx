import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders the Blynk shell', () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByTestId('app-shell')).toBeInTheDocument();
});
