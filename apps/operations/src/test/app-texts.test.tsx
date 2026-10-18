import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { EMPTY_APP_TEXTS } from '../lib/appTexts';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/** App texts in Ops (owner, 2026-10-18: "make sure each and everything was editable from the admin"). */
afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('App texts (Ops)', () => {
  it('edits a word, a list line and an aisle colour, and saves them with PATCH', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/app-texts', {
      'GET /admin/settings/app-texts': () => ok({ ...EMPTY_APP_TEXTS, updated_at: null }),
      'GET /admin/categories': () => ok({ categories: [{ id: 'c1', name: 'Rice', slug: 'rice', is_active: true, display_order: 1, parent_id: null }] }),
      'PATCH /admin/settings/app-texts': (call) => ok({ ...EMPTY_APP_TEXTS, ...(call.body as object), updated_at: null }),
    });

    const strip = await screen.findByLabelText('Cart bar strip');
    expect(strip).toHaveAttribute('placeholder', 'Great picks, every time!');
    await user.type(strip, 'Weekend deals!');
    await user.click(screen.getByRole('button', { name: 'Add login headline' }));
    await user.type(screen.getByLabelText('Login headline 1'), 'Hello Dharga');
    expect(await screen.findByLabelText('Rice colour')).toBeInTheDocument();
    expect(screen.getByLabelText('Cart bar colour')).toHaveValue('#ffe141');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-texts')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/app-texts')[0]!.body).toMatchObject({
      cart_bar_line: 'Weekend deals!',
      login_headlines: ['Hello Dharga'],
    });
    expect(await screen.findByText('App texts saved.')).toBeInTheDocument();
  });
});
