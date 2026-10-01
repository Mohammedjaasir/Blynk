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
    phone: '+94774443322',
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
  phone: '+94775551122',
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
          account({ id: 's2', full_name: 'Ops Person', email: 'ops@blynk.lk', role: 'OPERATIONS', disabled: true }),
          ADMIN_ROW,
        ],
      })
    );
    renderPage();
    const table = await screen.findByRole('table', { name: 'Staff accounts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Kasun Perera');
    expect(rows[0]).toHaveTextContent('kasun@blynk.lk');
    expect(rows[0]).toHaveTextContent('+94774443322');
    expect(rows[0]).toHaveTextContent('Inventory');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('Operations');
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
    expect(within(dialog).getByText(/Sri Lankan mobile number/)).toBeInTheDocument();
    expect(sent('POST', '/admin/staff')).toHaveLength(0);
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

    expect(await screen.findByText(/Account created for Ops Person\. They sign in to the Blynk Operations app/)).toBeInTheDocument();
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

  it('changes the role', async () => {
    const user = userEvent.setup();
    stub((method) =>
      method === 'PATCH' ? respond({ staff: account({ role: 'OPERATIONS' }) }) : respond({ staff: [account()] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Change role' }));
    const dialog = screen.getByRole('dialog', { name: 'Change role' });
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), 'OPERATIONS');
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(sent('PATCH', '/admin/staff/s1')).toEqual([{ role: 'OPERATIONS' }]));
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    await waitFor(() => expect(row).toHaveTextContent('Operations'));
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
});
