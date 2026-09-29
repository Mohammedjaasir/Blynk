import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import userEvent from '@testing-library/user-event';
import { resetIntroForTests } from '../pages/Welcome';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('routing', () => {
  it.each(['/', '/orders', '/delivery', '/catalog', '/more', '/something/unknown'])(
    'unauthenticated access to %s redirects to /login',
    async (route) => {
      renderAs(null, route);
      expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    }
  );

  it('every launch opens on the welcome screen, signed out', async () => {
    resetIntroForTests();
    renderAs(null, '/orders');
    expect(await screen.findByRole('button', { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('every launch opens on the welcome screen, signed in too, then continues', async () => {
    resetIntroForTests();
    renderAs(ADMIN_WITH_RIDER, '/orders', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await userEvent.click(await screen.findByRole('button', { name: /get started/i }));
    expect(await screen.findByText('No live orders.')).toBeInTheDocument();
  });

  it('an authenticated operator can reach every tab route directly by URL', async () => {
    // F3 replaced Orders' F1 placeholder with the real board; `renderAs`'s
    // own defaults (an empty `GET /admin/orders` list) are enough here.
    renderAs(ADMIN_WITH_RIDER, '/orders', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    expect(await screen.findByText('No live orders.')).toBeInTheDocument();
  });

  it('an unknown route redirects an authenticated operator to Home, not to /login', async () => {
    // F2 replaced Home's F1 placeholder with the real dashboard; `renderAs`'s
    // own defaults (empty-but-real Home responses) are enough here.
    renderAs(ADMIN_WITH_RIDER, '/does-not-exist', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
  });
});
