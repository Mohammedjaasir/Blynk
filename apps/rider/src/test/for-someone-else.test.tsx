import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, detail, ok, renderAs } from './helpers';

// Order for family / someone else, and "needs help" (owner, 2026-10-12).
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetTrackerSessionForTests();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Delivery screen: order for someone else', () => {
  it('shows "needs help", the note and the receiver to call', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () =>
        ok({
          delivery: detail({
            delivery_recipient_name: 'Amma Fathima',
            delivery_recipient_phone: '+94709450001',
            delivery_instructions: 'Blue gate',
            ordered_for_someone_else: true,
            delivery_needs_help: true,
          }),
        }),
    });
    expect(await screen.findByTestId('needs-help')).toHaveTextContent('Please knock and wait. Carry the items inside.');
    expect(screen.getByTestId('for-someone-else')).toHaveTextContent('Ordered by family');
    expect(screen.getByText('Blue gate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Amma Fathima' })).toHaveAttribute('href', 'tel:+94709450001');
  });

  it('shows neither note on an ordinary order', async () => {
    renderAs(RIDER, '/deliveries/d-1', { 'GET /riders/deliveries/:id': () => ok({ delivery: detail() }) });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-help')).not.toBeInTheDocument();
    expect(screen.queryByTestId('for-someone-else')).not.toBeInTheDocument();
  });
});
