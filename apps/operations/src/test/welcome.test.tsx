import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Welcome, hasSeenIntro, resetIntroForTests } from '../pages/Welcome';

function renderWelcome(from?: string) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/welcome', state: from ? { from: { pathname: from, search: '' } } : null }]}
    >
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<p>home route</p>} />
        <Route path="/orders" element={<p>orders route</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Ops welcome screen', () => {
  beforeEach(() => resetIntroForTests()); // a fresh launch

  it('shows the headline and the four areas of the app', () => {
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run your store, deliver faster');
    for (const label of ['Orders', 'Deliveries', 'Catalog', 'Stock']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('Get Started continues to where the launch was headed', async () => {
    renderWelcome('/orders');
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByText('orders route')).toBeInTheDocument();
    expect(hasSeenIntro()).toBe(true);
  });

  it('Skip does the same, and with nowhere recorded goes Home', async () => {
    renderWelcome();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('home route')).toBeInTheDocument();
    expect(hasSeenIntro()).toBe(true);
  });

  it('is only remembered for this launch, never stored on the device', async () => {
    renderWelcome();
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(window.localStorage.length).toBe(0);
    resetIntroForTests(); // the next launch
    expect(hasSeenIntro()).toBe(false);
  });
});
