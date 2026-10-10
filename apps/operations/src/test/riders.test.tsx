import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const RIDERS = [
  {
    id: 'r1',
    full_name: 'Farhan Mohamed',
    phone: '+94779876543',
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: 'WP-BCX-8842',
    open_deliveries: 2,
  },
  {
    id: 'r2',
    full_name: null,
    phone: '+94775551199',
    vehicle_type: 'BICYCLE',
    vehicle_registration_number: 'N/A',
    open_deliveries: 0,
  },
];

describe('Riders', () => {
  it('is reachable from the More tab', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/more', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    await user.click(await screen.findByRole('link', { name: 'Riders' }));
    expect(await screen.findByRole('heading', { name: 'Riders' })).toBeInTheDocument();
  });

  it('renders the real rider list from a mocked response, including the open-deliveries count and vehicle type', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });

    expect(await screen.findByText('Farhan Mohamed')).toBeInTheDocument();
    expect(screen.getByText(/MOTORCYCLE/)).toBeInTheDocument();
    expect(screen.getByText('WP-BCX-8842')).toBeInTheDocument();
    expect(screen.getByText('2 open deliveries')).toBeInTheDocument();

    // A rider with no full_name falls back to phone; 0 open deliveries is
    // its own singular-safe copy, not "0 open deliveries".
    expect(screen.getByText('+94775551199')).toBeInTheDocument();
    expect(screen.getByText(/BICYCLE/)).toBeInTheDocument();
    expect(screen.getByText('No open deliveries')).toBeInTheDocument();
  });

  it('shows a real error, not a silent failure, when the list cannot load', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => fail(500, 'INTERNAL', 'boom'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The Blynk API had a problem. Try again in a moment.');
  });

  it('empty state ("No active riders") matches the real empty-list case, with no fabricated data', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: [] }) });
    expect(await screen.findByText('No active riders')).toBeInTheDocument();
  });

  it('offers no create/activate/deactivate control - only "Change pay", "Adjust pay" and "Documents" per rider (owner, 2026-10-09/10)', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    await screen.findByText('Farhan Mohamed');

    // The only buttons are each rider's pay control (PATCH /admin/riders/:id/pay)
    // , their documents and pay adjustments (owner, 2026-10-10); the backend
    // still has no rider create/activate/deactivate endpoint.
    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(RIDERS.length * 3);
    for (const b of buttons) expect(b.textContent).toMatch(/^(Change pay|Adjust pay|Documents)$/);
    for (const forbidden of [/add/i, /new rider/i, /create/i, /edit/i, /activate/i, /deactivate/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('the honest provisioning note is real, visible copy, not hidden or implied by a disabled control', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    expect(
      await screen.findByText('Rider accounts are currently provisioned outside this app.', { exact: false })
    ).toBeInTheDocument();
  });

  it('shows each rider type and % - own, or the store default (owner, 2026-10-09)', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () =>
        ok({
          riders: [
            { ...RIDERS[0], pay_type: 'COMMISSION', commission_percent: null },
            { ...RIDERS[1], pay_type: 'COMPANY', commission_percent: null },
            { ...RIDERS[0], id: 'r3', full_name: 'Nimal', pay_type: 'COMMISSION', commission_percent: 72.5 },
          ],
        }),
      'GET /admin/settings/rider-commission': () => ok({ default_percent: 80, updated_at: null }),
    });
    expect(await screen.findByText('Commission · 80% (default)')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Commission · 72.5%')).toBeInTheDocument();
  });

  it('changes a rider to commission with an own % via PATCH /admin/riders/:id/pay', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDERS[0], pay_type: 'COMPANY', commission_percent: null }] }),
      'GET /admin/settings/rider-commission': () => ok({ default_percent: 80, updated_at: null }),
      'GET /admin/riders/:id/pay': () =>
        ok({ pay: { rider_id: 'r1', pay_type: 'COMPANY', commission_percent: null, effective_percent: null, default_percent: 80 } }),
      'PATCH /admin/riders/:id/pay': (call) =>
        ok({
          pay: {
            rider_id: 'r1',
            pay_type: call.body.pay_type,
            commission_percent: call.body.commission_percent,
            effective_percent: call.body.commission_percent ?? 80,
            default_percent: 80,
          },
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Change pay for Farhan Mohamed' }));
    const dialog = screen.getByRole('dialog', { name: 'Rider pay' });
    const commission = await within(dialog).findByRole('button', { name: 'Commission' });
    expect(within(dialog).getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(commission);
    // A new commission rider starts on the store default model (owner, 2026-10-10).
    const model = within(dialog).getByRole('group', { name: 'Pay per delivery' });
    expect(within(model).getByRole('button', { name: 'Store default' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(model).getByRole('button', { name: '% of fee' }));
    const percent = within(dialog).getByLabelText(/Own commission %/);
    expect(percent).toHaveValue('80'); // prefilled from the store default
    await user.clear(percent);
    await user.type(percent, '85');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r1/pay')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/riders/r1/pay')[0].body).toEqual({
      pay_type: 'COMMISSION',
      pay_model: 'PERCENT',
      commission_percent: 85,
      min_lkr: null,
    });
    expect(await screen.findByText('Farhan Mohamed is now Commission · 85%.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Commission · 85%')).toBeInTheDocument();
  });

  it('switching back to company sends commission_percent null and shows a server error', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDERS[0], pay_type: 'COMMISSION', commission_percent: 90 }] }),
      'GET /admin/riders/:id/pay': () =>
        ok({ pay: { rider_id: 'r1', pay_type: 'COMMISSION', commission_percent: 90, effective_percent: 90, default_percent: 80 } }),
      'PATCH /admin/riders/:id/pay': () => fail(404, 'RIDER_NOT_FOUND', 'Rider not found'),
    });
    await user.click(await screen.findByRole('button', { name: 'Change pay for Farhan Mohamed' }));
    const dialog = screen.getByRole('dialog', { name: 'Rider pay' });
    expect(await within(dialog).findByLabelText(/Own commission %/)).toHaveValue('90');
    await user.click(within(dialog).getByRole('button', { name: 'Company' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r1/pay')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/riders/r1/pay')[0].body).toEqual({ pay_type: 'COMPANY', commission_percent: null });
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });

  it('links to the earnings report', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    expect(await screen.findByRole('link', { name: 'Earnings' })).toHaveAttribute('href', '/more/earnings');
  });
});
