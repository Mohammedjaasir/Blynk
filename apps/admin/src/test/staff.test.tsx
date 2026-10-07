import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Staff } from '../pages/Staff';
import { tokenStore } from '../api/client';
import type { StaffAccount } from '../api/types';

/**
 * Staff accounts page (backend migration 014): list, create, reset password,
 * change role, disable/enable. The API rules (ADMIN only, 409s, never an
 * ADMIN or the caller) are tested against PostgreSQL in
 * backend/api/tests/staff-accounts.test.ts.
 */

function respond(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data })),
  } as Response);
}

function account(overrides: Partial<StaffAccount> = {}): StaffAccount {
  return {
    id: 's1',
    full_name: 'Kasun Perera',
    email: 'kasun@blynk.lk',
    // Inventory and Admin accounts have no phone (backend migration 028).
    phone: null,
    role: 'PACKING_STAFF',
    has_password: true,
    disabled: false,
    read_only: false,
    created_at: '2026-09-29T04:30:00.000Z',
    ...overrides,
  };
}

const ADMIN_ROW = account({
  id: 'a1',
  full_name: 'Nawaz Mansoor',
  email: 'ops.admin@blynk.lk',
  phone: null,
  role: 'ADMIN',
  read_only: true,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Staff />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('Staff accounts page', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  function stub(handler: (method: string, path: string, body: Record<string, unknown> | undefined) => Promise<Response>) {
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^.*\/api\/v1/, '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      return handler(init?.method ?? 'GET', path, body);
    });
    vi.stubGlobal('fetch', fetchMock);
  }
  const sent = (method: string, path: string) =>
    fetchMock.mock.calls
      .filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(path))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it('lists each account with its role label and status; admins are read-only', async () => {
    stub(() =>
      respond({
        staff: [
          account(),
          account({ id: 's2', full_name: 'Ops Person', email: 'ops@blynk.lk', phone: '+94771230000', role: 'OPERATIONS', disabled: true }),
          ADMIN_ROW,
        ],
      })
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'Staff accounts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Kasun Perera');
    expect(rows[0]).toHaveTextContent('kasun@blynk.lk');
    // No phone: a dash, never a placeholder.
    expect(within(rows[0]).getAllByRole('cell')[2]).toHaveTextContent('—');
    expect(rows[0]).toHaveTextContent('Inventory');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('Operations');
    expect(rows[1]).toHaveTextContent('+94771230000');
    expect(rows[1]).toHaveTextContent('Disabled');
    expect(within(rows[1]).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Admin');
    expect(rows[2]).toHaveTextContent('Read-only');
    expect(within(rows[2]).queryAllByRole('button')).toHaveLength(0);
  });

  it('validates the create form inline before sending anything', async () => {
    const user = userEvent.setup();
    stub(() => respond({ staff: [] }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    expect(within(dialog).getByText('At least 8 characters.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Email'), 'not-an-email');
    await user.type(within(dialog).getByLabelText('Password'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(within(dialog).getByText('Enter their full name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument();
    // Inventory (the default role) has no phone; Operations needs one.
    expect(within(dialog).queryByLabelText(/Phone/)).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(within(dialog).getByText(/Sri Lankan mobile number/)).toBeInTheDocument();
    expect(sent('POST', '/admin/staff')).toHaveLength(0);
  });

  it.each([
    ['PACKING_STAFF', 'Inventory'],
    ['ADMIN', 'Admin'],
  ])('creates a %s account without a phone', async (role, label) => {
    const user = userEvent.setup();
    stub((method, _path, body) =>
      method === 'POST'
        ? respond({ staff: account({ id: 's8', full_name: String(body!.full_name), role: role as StaffAccount['role'], phone: null }) }, 201)
        : respond({ staff: [] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), role);
    expect(within(dialog).queryByLabelText(/Phone/)).toBeNull();
    expect(within(dialog).getByText(`${label} accounts sign in with email and password only, and have no phone number.`)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Full name'), 'No Phone');
    await user.type(within(dialog).getByLabelText('Email'), 'nophone@blynk.lk');
    await user.type(within(dialog).getByLabelText('Password'), 'Correct-horse-1');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(sent('POST', '/admin/staff')).toEqual([
        { full_name: 'No Phone', email: 'nophone@blynk.lk', password: 'Correct-horse-1', role },
      ])
    );
  });

  it('creates an Operations account, shows a loading state, and names the app to sign in to', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    stub((method, _path, body) => {
      if (method === 'POST') {
        return new Promise<void>((r) => (release = r)).then(() =>
          respond(
            { staff: account({ id: 's9', full_name: String(body!.full_name), email: String(body!.email), role: 'OPERATIONS' }) },
            201
          )
        );
      }
      return respond({ staff: [ADMIN_ROW] });
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    await user.type(within(dialog).getByLabelText('Full name'), '  Ops Person ');
    await user.type(within(dialog).getByLabelText('Email'), 'Ops@Blynk.LK');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    const password = within(dialog).getByLabelText('Password');
    await user.type(password, 'Correct-horse-1');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.type(within(dialog).getByLabelText(/Phone/), '077 123 4567');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await within(dialog).findByRole('status', { name: 'Creating account' })).toBeInTheDocument();
    release();

    expect(await screen.findByText(/Account created for Ops Person\. They sign in to the Blynk Ops app/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent('POST', '/admin/staff')).toEqual([
      { full_name: 'Ops Person', email: 'ops@blynk.lk', password: 'Correct-horse-1', role: 'OPERATIONS', phone: '077 123 4567' },
    ]);
    expect(within(screen.getByRole('table')).getByText('Ops Person')).toBeInTheDocument();
  });

  it.each([
    ['EMAIL_TAKEN', 'Another account already uses this email address.'],
    ['PHONE_TAKEN', 'Another account already uses this phone number.'],
  ])('shows a 409 %s next to its field', async (code, message) => {
    const user = userEvent.setup();
    stub((method) => (method === 'POST' ? respond({ code, message: 'taken' }, 409) : respond({ staff: [] })));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    await user.type(within(dialog).getByLabelText('Full name'), 'Kasun');
    await user.type(within(dialog).getByLabelText('Email'), 'kasun@blynk.lk');
    await user.type(within(dialog).getByLabelText('Password'), 'Correct-horse-1');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    await user.type(within(dialog).getByLabelText(/Phone/), '0774443322');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it('resets a password', async () => {
    const user = userEvent.setup();
    stub((method) => (method === 'PATCH' ? respond({ staff: account() }) : respond({ staff: [account()] })));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset password' });
    await user.type(within(dialog).getByLabelText('New password'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Set password' }));
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('New password'), '-and-longer');
    await user.click(within(dialog).getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(sent('PATCH', '/admin/staff/s1')).toEqual([{ password: 'short-and-longer' }]));
    expect(await screen.findByText('New password set for Kasun Perera.')).toBeInTheDocument();
  });

  it('changes the role to Operations, asking for a phone', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PATCH'
        ? respond({ staff: account({ role: 'OPERATIONS', phone: '+94771234567' }) })
        : respond({ staff: [account()] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change role' }));
    const dialog = screen.getByRole('dialog', { name: 'Change role' });
    expect(within(dialog).queryByLabelText(/Phone/)).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(within(dialog).getByText(/Sri Lankan mobile number/)).toBeInTheDocument();
    expect(sent('PATCH', '/admin/staff/s1')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Phone/), '077 123 4567');
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(sent('PATCH', '/admin/staff/s1')).toEqual([{ role: 'OPERATIONS', phone: '077 123 4567' }]));
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    await waitFor(() => expect(row).toHaveTextContent('Operations'));
    expect(row).toHaveTextContent('+94771234567');
  });

  it('changes the role to Inventory without a phone, saying the number goes', async () => {
    const user = userEvent.setup();
    const ops = account({ role: 'OPERATIONS', phone: '+94771234567' });
    stub((method) => (method === 'PATCH' ? respond({ staff: account() }) : respond({ staff: [ops] })));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change role' }));
    const dialog = screen.getByRole('dialog', { name: 'Change role' });
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'PACKING_STAFF');
    expect(within(dialog).getByText(/Inventory accounts have no phone number/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Phone/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(sent('PATCH', '/admin/staff/s1')).toEqual([{ role: 'PACKING_STAFF' }]));
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    await waitFor(() => expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('—'));
  });

  it('disables only after confirmation, then shows the account as disabled', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PATCH' ? respond({ staff: account({ disabled: true }) }) : respond({ staff: [account()] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Disable' }));
    const confirm = screen.getByRole('dialog', { name: 'Disable account' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(sent('PATCH', '/admin/staff/s1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Disable account' })).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(sent('PATCH', '/admin/staff/s1')).toEqual([{ disabled: true }]));
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Disabled')).toBeInTheDocument();
  });

  // ------------------------------------------------------------ can deliver
  const OPS = account({ id: 's2', full_name: 'Store Lead', email: 'lead@blynk.lk', role: 'OPERATIONS', rider: null });
  const RIDER = { id: 'r9', is_active: true, vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-LEAD-1' };

  it('offers "Can deliver" on Operations and Admin rows only', async () => {
    stub(() => respond({ staff: [account(), OPS, { ...ADMIN_ROW, rider: RIDER }] }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Staff accounts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('switch', { name: 'Can deliver: Store Lead' })).not.toBeChecked();
    expect(within(rows[2]).getByRole('switch', { name: 'Can deliver: Nawaz Mansoor' })).toBeChecked();
    expect(rows[2]).toHaveTextContent('Motorcycle · WP-LEAD-1');
  });

  it('turning it on the first time asks for the vehicle and sends it', async () => {
    const user = userEvent.setup();
    stub((method) => (method === 'PUT' ? respond({ rider: { ...RIDER, vehicle_type: 'SCOOTER' } }) : respond({ staff: [OPS] })));
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Can deliver: Store Lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Let this account deliver' });
    await user.click(within(dialog).getByRole('button', { name: 'Let deliver' }));
    expect(within(dialog).getByText('Enter the number plate.')).toBeInTheDocument();
    expect(sent('PUT', '/admin/staff/s2/rider')).toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText('Vehicle'), 'SCOOTER');
    await user.type(within(dialog).getByLabelText(/Registration number/), 'WP-LEAD-1');
    await user.click(within(dialog).getByRole('button', { name: 'Let deliver' }));
    await waitFor(() =>
      expect(sent('PUT', '/admin/staff/s2/rider')).toEqual([
        { can_deliver: true, vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-LEAD-1' },
      ])
    );
    expect(await screen.findByRole('switch', { name: 'Can deliver: Store Lead' })).toBeChecked();
    expect(screen.getByText('Scooter · WP-LEAD-1')).toBeInTheDocument();
  });

  it('turning it back on reuses the existing profile without asking again', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PUT' ? respond({ rider: RIDER }) : respond({ staff: [{ ...OPS, rider: { ...RIDER, is_active: false } }] })
    );
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Can deliver: Store Lead' }));
    await waitFor(() => expect(sent('PUT', '/admin/staff/s2/rider')).toEqual([{ can_deliver: true }]));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('turning it off asks first, and shows the API refusal when they still hold a delivery', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PUT'
        ? respond({ code: 'RIDER_HAS_OPEN_DELIVERIES', message: 'This rider still has 1 open delivery. Finish or reassign it first.' }, 409)
        : respond({ staff: [{ ...OPS, rider: RIDER }] })
    );
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Can deliver: Store Lead' }));
    const confirm = screen.getByRole('dialog', { name: 'Stop delivering' });
    await user.click(within(confirm).getByRole('button', { name: 'Stop delivering' }));
    await waitFor(() => expect(sent('PUT', '/admin/staff/s2/rider')).toEqual([{ can_deliver: false }]));
    expect(await screen.findByText('This rider still has 1 open delivery. Finish or reassign it first.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Can deliver: Store Lead' })).toBeChecked();
  });

  // ------------------------------------------------- admin and rider accounts
  const RIDER_ROW = account({
    id: 'r1',
    full_name: 'Rider Ravi',
    email: 'ravi@blynk.lk',
    phone: '+94771112233',
    role: 'RIDER',
    rider: { id: 'rr1', is_active: true, vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-RAVI-1', emergency_contact_phone: null },
  });

  it('offers Inventory, Operations and Admin, and names each role’s app', async () => {
    const user = userEvent.setup();
    stub(() => respond({ staff: [] }));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    const select = within(dialog).getByLabelText(/^Role/);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Inventory', 'Operations', 'Admin']);
    expect(within(dialog).getByText('Signs in to the Blynk Inventory website only.')).toBeInTheDocument();
    await user.selectOptions(select, 'ADMIN');
    expect(within(dialog).getByText('Signs in to the Blynk Admin website only.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Registration number')).toBeNull();
  });

  it('does not create riders: they apply in the Rider app and are approved under Rider requests', async () => {
    stub(() => respond({ staff: [] }));
    renderPage();
    expect(await screen.findByText(/New riders apply in the Rider app and are approved under Rider requests/)).toBeInTheDocument();
  });

  it('filters by role; riders show their vehicle and can be edited but not moved to another role', async () => {
    const user = userEvent.setup();
    stub((method, _path, body) =>
      method === 'PATCH'
        ? respond({ staff: { ...RIDER_ROW, rider: { ...RIDER_ROW.rider!, vehicle_registration_number: String(body!.vehicle_registration_number) } } })
        : respond({ staff: [account(), RIDER_ROW, ADMIN_ROW] })
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'Staff accounts' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    await user.selectOptions(screen.getByLabelText('Show'), 'RIDER');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Rider Ravi');
    expect(rows[0]).toHaveTextContent('Scooter · WP-RAVI-1');
    expect(within(rows[0]).queryByRole('button', { name: 'Change role' })).toBeNull();

    await user.click(within(rows[0]).getByRole('button', { name: 'Edit rider' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit rider' });
    const plate = within(dialog).getByLabelText(/Registration number/);
    await user.clear(plate);
    await user.type(plate, 'WP-RAVI-2');
    await user.click(within(dialog).getByRole('button', { name: 'Save rider' }));
    await waitFor(() =>
      expect(sent('PATCH', '/admin/staff/r1')).toEqual([
        { vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-RAVI-2', emergency_contact_phone: null },
      ])
    );
    expect(await within(table).findByText('Scooter · WP-RAVI-2')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show'), 'OPERATIONS');
    expect(screen.getByText('No Operations accounts')).toBeInTheDocument();
  });

  it('shows the refusal when disabling a rider who still holds a delivery', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PATCH'
        ? respond({ code: 'RIDER_HAS_OPEN_DELIVERIES', message: 'This account still has 1 open delivery. Finish or reassign it before disabling it.' }, 409)
        : respond({ staff: [RIDER_ROW] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Disable' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Disable account' })).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText(/still has 1 open delivery/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });
});
