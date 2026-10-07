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
    expect(api.calls[0].query.get('status')).toBe('PENDING');
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
