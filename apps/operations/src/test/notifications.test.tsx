import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/** Notifications in Ops (owner, 2026-10-19: "store is open now, start ordering"). */
afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Notifications (Ops)', () => {
  it('sends the store-open message after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/notifications', {
      'GET /admin/push-broadcasts/audience': () => ok({ push_enabled: true, customers: 7, devices: 9 }),
      'GET /admin/push-broadcasts': () => ok({ broadcasts: [] }),
      'POST /admin/push-broadcasts': () => ok({ id: 'b1', queued: 7 }),
    });
    expect(await screen.findByTestId('audience')).toHaveTextContent('7 customers');
    await user.click(screen.getByRole('button', { name: /Store is open/ }));
    await user.click(screen.getByRole('button', { name: 'Send notification' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(1));
    expect(await screen.findByText('Sent to 7 customers.')).toBeInTheDocument();
  });
});
