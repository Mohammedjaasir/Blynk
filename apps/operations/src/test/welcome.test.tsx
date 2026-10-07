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

  it('"Sign in" continues to where the launch was headed', async () => {
    renderWelcome('/login');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText('login route')).toBeInTheDocument();
    expect(hasSeenIntro()).toBe(true);
  });

  it('is the Ops look, not the Rider one: no scooter scene, no sign-up wording (owner, 2026-10-07)', () => {
    const { container } = renderWelcome();
    expect(container.querySelector('.intro--ops')).not.toBeNull();
    expect(container.querySelector('img[src*="intro-art"], img[src*="scooter"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /get started|already have an account/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
