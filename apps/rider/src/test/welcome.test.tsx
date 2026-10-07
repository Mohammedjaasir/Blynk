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
        <Route path="/" element={<p>queue route</p>} />
        <Route path="/login" element={<p>login route</p>} />
        <Route path="/apply" element={<p>apply route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Rider welcome screen', () => {
  beforeEach(() => resetIntroForTests());

  it("shows the reference's headline and the three feature cards", () => {
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deliver Happiness Earn More');
    for (const t of ['Good Earnings', 'Flexible Hours', 'Be Part of the Community']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.queryByText('₹')).not.toBeInTheDocument();
  });

  it('Get Started opens the rider application', async () => {
    renderWelcome('/login');
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByText('apply route')).toBeInTheDocument();
    expect(hasSeenIntro()).toBe(true);
  });

  it.each([/i already have an account/i, /^skip$/i])(
    '%s continues to where the launch was headed',
    async (name) => {
      renderWelcome('/login');
      await userEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByText('login route')).toBeInTheDocument();
      expect(hasSeenIntro()).toBe(true);
    },
  );
});
