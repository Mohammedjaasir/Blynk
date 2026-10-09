import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { RiderRequests, readablePhone } from '../pages/RiderRequests';
import { tokenStore } from '../api/client';
import type { RiderApplication } from '../api/types';
import { fail, mockApi, ok } from './mockApi';

/**
 * Rider requests: list by status, approve (with confirmation) and reject (a
 * reason is required). The API contract is tested against PostgreSQL in
 * backend/api/tests/rider-applications.test.ts.
 */

function application(overrides: Partial<RiderApplication> = {}): RiderApplication {
  return {
    id: 'r1',
    user_id: 'u1',
    full_name: 'Sunil Silva',
    phone: '+94771234567',
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: 'WP BAA-1234',
    emergency_contact_phone: '+94712223333',
    approval_status: 'PENDING',
    applied_at: '2026-10-07T04:30:00.000Z',
    reviewed_at: null,
    reviewed_by_name: null,
    rejection_reason: null,
    ...overrides,
  };
}

const page = (applications: RiderApplication[]) => ({
  applications,
  pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RiderRequests />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('Rider requests', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('formats Sri Lankan numbers for reading', () => {
    expect(readablePhone('+94771234567')).toBe('077 123 4567');
    expect(readablePhone(null)).toBe('—');
  });

  it('lists waiting applications with phone, vehicle and plate', async () => {
    const api = mockApi((c) => (c.path === '/admin/rider-applications' ? ok(page([application()])) : undefined));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Rider requests' });
    expect(within(table).getByText('Sunil Silva')).toBeInTheDocument();
    expect(within(table).getByText('077 123 4567')).toBeInTheDocument();
    expect(within(table).getByText('Motorcycle')).toBeInTheDocument();
    expect(within(table).getByText('WP BAA-1234')).toBeInTheDocument();
    expect(api.find('GET', '/admin/rider-applications')[0].query.get('status')).toBe('PENDING');
  });

  it('approves after confirmation and reloads the list', async () => {
    let approved = false;
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page(approved ? [] : [application()]));
      if (c.method === 'POST' && c.path === '/admin/rider-applications/r1/approve') {
        approved = true;
        return ok({ application: application({ approval_status: 'APPROVED' }) });
      }
      return undefined;
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('No rider requests waiting')).toBeInTheDocument();
    expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1);
    expect(screen.getByText(/Sunil Silva is approved/)).toBeInTheDocument();
    // Company is picked unless changed (owner, 2026-10-09).
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({ pay_type: 'COMPANY', commission_percent: null });
  });

  it('approves a commission rider with their own %, or the default when left blank (owner, 2026-10-09)', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([application(), application({ id: 'r2', full_name: 'Kamal' })]));
      if (c.method === 'POST') return ok({ application: application({ approval_status: 'APPROVED' }) });
      return undefined;
    });
    renderPage();

    const rows = within(await screen.findByRole('table', { name: 'Rider requests' })).getAllByRole('row');
    await user.click(within(rows[1]).getByRole('button', { name: 'Approve' }));
    let dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    const company = within(dialog).getByRole('button', { name: 'Company' });
    expect(company).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).queryByLabelText(/Own commission/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    expect(within(dialog).getByRole('button', { name: 'Commission' })).toHaveAttribute('aria-pressed', 'true');
    const own = within(dialog).getByLabelText(/Own commission/);
    expect(await within(dialog).findByText(/Leave blank to use the default 80%/)).toBeInTheDocument();

    // A bad % is refused before calling the API.
    await user.type(own, '120');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(within(dialog).getByText('Enter a percentage from 0 to 100.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(0);

    await user.clear(own);
    await user.type(own, '75');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/rider-applications/r1/approve')[0]?.body).toEqual({ pay_type: 'COMMISSION', commission_percent: 75 })
    );

    // Blank own % = the store default (null).
    const again = within(await screen.findByRole('table', { name: 'Rider requests' })).getAllByRole('row');
    await user.click(within(again[2]).getByRole('button', { name: 'Approve' }));
    dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/rider-applications/r2/approve')[0]?.body).toEqual({ pay_type: 'COMMISSION', commission_percent: null })
    );
  });

  it("shows each approved rider's type and % on the Approved tab", async () => {
    mockApi((c) => {
      if (c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      if (c.query.get('status') === 'APPROVED') {
        return ok(
          page([
            application({ approval_status: 'APPROVED', pay_type: 'COMPANY', commission_percent: null }),
            application({ id: 'r2', full_name: 'Kamal', approval_status: 'APPROVED', pay_type: 'COMMISSION', commission_percent: 72.5 }),
            application({ id: 'r3', full_name: 'Nimal', approval_status: 'APPROVED', pay_type: 'COMMISSION', commission_percent: null }),
          ])
        );
      }
      return ok(page([]));
    });
    renderPage();
    await screen.findByText('No rider requests waiting');
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }));
    const table = await screen.findByRole('table', { name: 'Rider requests' });
    expect(within(table).getByRole('columnheader', { name: 'Pay' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Company');
    expect(rows[2]).toHaveTextContent('Commission · 72.5%');
    expect(rows[3]).toHaveTextContent('Commission · 80% (default)');
  });

  it('needs a reason to reject, and sends it', async () => {
    const api = mockApi((c) => {
      if (c.method === 'GET') return ok(page([application()]));
      if (c.path === '/admin/rider-applications/r1/reject') return ok({ application: application({ approval_status: 'REJECTED' }) });
      return undefined;
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject rider request' });
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'No licence');
    await userEvent.click(confirm);

    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/reject')[0].body).toEqual({ reason: 'No licence' });
  });

  it('shows who reviewed and why on the Rejected tab', async () => {
    mockApi((c) =>
      c.query.get('status') === 'REJECTED'
        ? ok(page([application({ approval_status: 'REJECTED', reviewed_at: '2026-10-07T05:00:00.000Z', reviewed_by_name: 'Owner', rejection_reason: 'No licence' })]))
        : ok(page([]))
    );
    renderPage();

    await screen.findByText('No rider requests waiting');
    await userEvent.click(screen.getByRole('button', { name: 'Rejected' }));
    expect(await screen.findByText('Reason: No licence')).toBeInTheDocument();
    expect(screen.getByText('by Owner')).toBeInTheDocument();
  });

  it('says so when the list cannot load', async () => {
    mockApi(() => fail(500, 'INTERNAL_ERROR', 'Server down'));
    renderPage();
    expect(await screen.findByText(/Server down|Could not load rider requests/)).toBeInTheDocument();
  });
});
