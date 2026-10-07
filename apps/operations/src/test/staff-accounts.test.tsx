import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { StaffAccount } from '../api/types';
import { ADMIN_NO_RIDER, OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * More -> Staff accounts (owner, 2026-10-01). The screen offers only what
 * the signed-in user may do; the backend's permission matrix
 * (backend/api/tests/staff-permissions.test.ts) is the real guard.
 */

// Form-heavy screens behind the full auth + shell boot: generous under a
// loaded, fully parallel run (as catalog-delete.test.tsx does).
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function account(overrides: Partial<StaffAccount> = {}): StaffAccount {
  return {
    id: 's1',
    full_name: 'Kasun Perera',
    email: 'kasun@blynk.lk',
    phone: '+94774443322',
    role: 'PACKING_STAFF',
    has_password: true,
    disabled: false,
    read_only: false,
    created_at: '2026-09-29T04:30:00.000Z',
    rider: null,
    ...overrides,
  };
}

const RIDER_ROW = account({
  id: 'r1',
  full_name: 'Rider Ravi',
  email: 'ravi@blynk.lk',
  phone: '+94771112244',
  role: 'RIDER',
  rider: { id: 'rr1', is_active: true, vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-RAVI-1', emergency_contact_phone: null },
});
const OPS_ROW = account({ id: 'o1', full_name: 'Other Operator', email: 'op2@blynk.lk', role: 'OPERATIONS' });
const ADMIN_ROW = account({ id: 'a1', full_name: 'Nawaz Mansoor', email: 'admin@blynk.lk', role: 'ADMIN', read_only: true });

const roleOptions = (dialog: HTMLElement) =>
  within(within(dialog).getByLabelText(/^Role/)).getAllByRole('option').map((o) => o.textContent);

describe('More -> Staff accounts as Operations', () => {
  it('is reachable from More and lists Inventory and Rider accounts with the rider vehicle', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/staff': () => ok({ staff: [account(), RIDER_ROW] }) });
    await user.click(await screen.findByRole('link', { name: 'Staff accounts' }));
    const list = await screen.findByRole('list', { name: 'Staff accounts' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Kasun Perera');
    expect(items[0]).toHaveTextContent('Inventory');
    expect(items[1]).toHaveTextContent('Rider');
    expect(items[1]).toHaveTextContent('Scooter · WP-RAVI-1');
    expect(within(items[1]).getByRole('button', { name: 'Edit rider' })).toBeInTheDocument();
    // Operations never changes roles.
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
  });

  it('offers only Inventory: riders apply in the Rider app and are approved under Rider requests', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/staff', { 'GET /admin/staff': () => ok({ staff: [] }) });
    expect(await screen.findByText(/New riders apply in the Rider app; approve them under Rider requests/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(roleOptions(screen.getByRole('dialog', { name: 'Create account' }))).toEqual(['Inventory']);
  });

  it('creates an Inventory account with no phone and names the Inventory website', async () => {
    const user = userEvent.setup();
    const { api: { find } } = renderAs(OPERATIONS_STAFF, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [] }),
      'POST /admin/staff': (call: Call) =>
        ok({ staff: account({ id: 's9', phone: null, full_name: call.body.full_name, email: call.body.email }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    // Inventory accounts sign in with email and password only: no phone asked.
    expect(within(dialog).queryByLabelText(/^Phone/)).toBeNull();
    expect(within(dialog).getByText(/No phone needed/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Packer Two');
    await user.type(within(dialog).getByLabelText(/^Email/), 'packer2@blynk.lk');
    await user.type(within(dialog).getByLabelText('Password'), 'Packer-pass-1');
    expect(within(dialog).queryByLabelText(/^Registration number/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/They sign in to the Blynk Inventory website/)).toBeInTheDocument();
    expect(find('POST', '/admin/staff').map((c) => c.body)).toEqual([
      { full_name: 'Packer Two', email: 'packer2@blynk.lk', password: 'Packer-pass-1', role: 'PACKING_STAFF' },
    ]);
    // The new row has no phone: shown as a dash.
    const row = within(screen.getByRole('list', { name: 'Staff accounts' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('—');
  });

  it('shows a dash for an account without a phone', async () => {
    renderAs(OPERATIONS_STAFF, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [account({ phone: null, full_name: null }), RIDER_ROW] }),
    });
    const items = within(await screen.findByRole('list', { name: 'Staff accounts' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('—');
    expect(items[0]).toHaveTextContent('kasun@blynk.lk');
    expect(items[1]).toHaveTextContent('+94771112244');
  });

  it('shows the refusal when disabling a rider who still holds a delivery', async () => {
    const user = userEvent.setup();
    const { api: { find } } = renderAs(OPERATIONS_STAFF, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [RIDER_ROW] }),
      'PATCH /admin/staff/:id': () =>
        fail(409, 'RIDER_HAS_OPEN_DELIVERIES', 'This account still has 1 open delivery. Finish or reassign it before disabling it.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Disable' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Disable account' })).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('still has 1 open delivery');
    expect(find('PATCH', '/admin/staff/r1').map((c) => c.body)).toEqual([{ disabled: true }]);
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('resets a password and edits a rider vehicle', async () => {
    const user = userEvent.setup();
    const { api: { find } } = renderAs(OPERATIONS_STAFF, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [RIDER_ROW] }),
      'PATCH /admin/staff/:id': (call: Call) =>
        ok({
          staff: call.body.vehicle_registration_number
            ? { ...RIDER_ROW, rider: { ...RIDER_ROW.rider!, vehicle_registration_number: call.body.vehicle_registration_number } }
            : RIDER_ROW,
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const reset = screen.getByRole('dialog', { name: 'Reset password' });
    await user.type(within(reset).getByLabelText('New password'), 'Fresh-pass-22');
    await user.click(within(reset).getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('New password set for Rider Ravi.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit rider' }));
    const edit = screen.getByRole('dialog', { name: 'Edit rider' });
    const plate = within(edit).getByLabelText(/^Registration number/);
    await user.clear(plate);
    await user.type(plate, 'WP-RAVI-2');
    await user.click(within(edit).getByRole('button', { name: 'Save rider' }));
    await waitFor(() =>
      expect(find('PATCH', '/admin/staff/r1').map((c) => c.body)).toEqual([
        { password: 'Fresh-pass-22' },
        { vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-RAVI-2', emergency_contact_phone: null },
      ])
    );
    expect(await screen.findByText('Scooter · WP-RAVI-2')).toBeInTheDocument();
  });
});

describe('More -> Staff accounts as an Admin', () => {
  it('sees every role, three to create (no riders), and Change role on Operations accounts', async () => {
    const user = userEvent.setup();
    const { api: { find } } = renderAs(ADMIN_NO_RIDER, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [account(), RIDER_ROW, OPS_ROW, ADMIN_ROW] }),
      'POST /admin/staff': (call: Call) =>
        ok({ staff: account({ id: 'a9', role: 'ADMIN', read_only: true, full_name: call.body.full_name, email: call.body.email }) }),
    });
    const list = await screen.findByRole('list', { name: 'Staff accounts' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[2]).getByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('Read-only');
    expect(within(items[3]).queryAllByRole('button')).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Show'), 'OPERATIONS');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    expect(roleOptions(dialog)).toEqual(['Inventory', 'Operations', 'Admin']);
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Second Admin');
    await user.type(within(dialog).getByLabelText(/^Email/), 'admin2@blynk.lk');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'ADMIN');
    await user.type(within(dialog).getByLabelText('Password'), 'Admin-pass-22');
    // Admin accounts are email + password only: no phone field, none sent.
    expect(within(dialog).queryByLabelText(/^Phone/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/They sign in to the Blynk Admin website/)).toBeInTheDocument();
    expect(find('POST', '/admin/staff')[0].body.role).toBe('ADMIN');
    expect(find('POST', '/admin/staff')[0].body).not.toHaveProperty('phone');
  });

  it('names the Ops app for a new Operations account', async () => {
    const user = userEvent.setup();
    const { api: { find } } = renderAs(ADMIN_NO_RIDER, '/more/staff', {
      'GET /admin/staff': () => ok({ staff: [] }),
      'POST /admin/staff': (call: Call) =>
        ok({ staff: account({ id: 'o9', role: 'OPERATIONS', full_name: call.body.full_name, email: call.body.email }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Ops Two');
    await user.type(within(dialog).getByLabelText(/^Email/), 'ops2@blynk.lk');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    await user.type(within(dialog).getByLabelText('Password'), 'Ops-pass-2222');
    await user.type(within(dialog).getByLabelText(/^Phone/), '0771112288');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/They sign in to the Blynk Ops app/)).toBeInTheDocument();
    expect(find('POST', '/admin/staff')[0].body.phone).toBe('0771112288');
  });
});
