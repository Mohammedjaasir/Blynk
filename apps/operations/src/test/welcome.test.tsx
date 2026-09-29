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
        <Route path="/login" element={<p>login route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('welcome screen (owner reference, 2026-09-28)', () => {
  beforeEach(() => resetIntroForTests());

  it('shows the headline and the feature cards', () => {
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run Blynk. From One Place.');
    for (const t of ['Manage Orders', 'Handle Deliveries', 'Control Inventory', 'Channel Doctors']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it.each([/get started/i, /i already have an account/i, /^skip$/i])('%s continues to where the launch was headed', async (name) => {
    renderWelcome('/login');
    await userEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByText('login route')).toBeInTheDocument();
    expect(hasSeenIntro()).toBe(true);
  });
});
