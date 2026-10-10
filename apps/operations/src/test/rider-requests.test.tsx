import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { RiderApplication } from '../api/types';
import { readablePhone } from '../pages/RiderRequests';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * More -> Rider requests (backend migration 029). The API contract is tested
 * against PostgreSQL in backend/api/tests/rider-applications.test.ts.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function application(overrides: Partial<RiderApplication> = {}): RiderApplication {
  return {
    id: 'r1',
    user_id: 'u1',
    full_name: 'Sunil Silva',
    phone: '+94771234567',
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: 'WP BAA-1234',
    emergency_contact_phone: null,
    approval_status: 'PENDING',
    applied_at: '2026-10-07T04:30:00.000Z',
    reviewed_at: null,
    reviewed_by_name: null,
    rejection_reason: null,
    // Rider documents (owner, 2026-10-10): nothing blocks approval here.
    documents: [],
    document_requirements: [],
    documents_blocking: [],
    documents_verified: true,
    ...overrides,
  };
}

const page = (applications: RiderApplication[]) => ({
  applications,
  pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
});

describe('Rider requests (Ops)', () => {
  it('formats Sri Lankan numbers for reading', () => {
    expect(readablePhone('+94771234567')).toBe('077 123 4567');
  });

  it('More shows the waiting count and links to the requests', async () => {
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/rider-applications/count': () => ok({ pending: 3 }),
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 0, updated_at: null }),
    });
    const link = await screen.findByRole('link', { name: /Rider requests/ });
    expect(link).toHaveAttribute('href', '/more/rider-requests');
    expect(await within(link).findByLabelText('3 waiting')).toBeInTheDocument();
  });

  it('lists a waiting rider and approves after confirmation', async () => {
    let approved = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page(approved ? [] : [application()])),
      'POST /admin/rider-applications/:id/approve': () => {
        approved = true;
        return ok({ application: application({ approval_status: 'APPROVED' }) });
      },
    });

    const list = await screen.findByRole('list', { name: 'Rider requests' });
    expect(within(list).getByText('Sunil Silva')).toBeInTheDocument();
    expect(within(list).getByText('077 123 4567')).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/Sunil Silva is approved/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1);
    // Company is the starting type (owner, 2026-10-09), sent explicitly.
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({ pay_type: 'COMPANY' });
    expect(screen.getByText('No rider requests waiting')).toBeInTheDocument();
  });

  it('approves as a commission rider with an own %, showing the store default as the hint (owner, 2026-10-09)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application()])),
      'GET /admin/settings/rider-commission': () => ok({ default_percent: 80, updated_at: null }),
      'POST /admin/rider-applications/:id/approve': () =>
        ok({ application: application({ approval_status: 'APPROVED', pay_type: 'COMMISSION', commission_percent: 75 }) }),
    });

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    const types = within(dialog).getByRole('group', { name: 'Rider type' });
    expect(within(types).getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true');
    // No % field for a company rider.
    expect(within(dialog).queryByLabelText(/Own commission %/)).toBeNull();

    await user.click(within(types).getByRole('button', { name: 'Commission' }));
    expect(within(types).getByRole('button', { name: 'Commission' })).toHaveAttribute('aria-pressed', 'true');
    // Store default first, naming it (owner, 2026-10-10); then an own %.
    expect(await within(dialog).findByText(/Follows the store default: 80% of the delivery fee/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '% of fee' }));
    expect(within(dialog).getByText(/Store default 80%/)).toBeInTheDocument();

    // A bad % is refused before anything is sent.
    const percent = within(dialog).getByLabelText(/Own commission %/);
    await user.clear(percent);
    await user.type(percent, '120');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText('The percentage can be at most 100.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(0);

    await user.clear(percent);
    await user.type(percent, '75');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({
      pay_type: 'COMMISSION',
      pay_model: 'PERCENT',
      commission_percent: 75,
      min_lkr: null,
    });
  });

  it('a commission rider left blank gets the store default (null)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application()])),
      'GET /admin/settings/rider-commission': () => ok({ default_percent: 80, updated_at: null }),
      'POST /admin/rider-applications/:id/approve': () => ok({ application: application({ approval_status: 'APPROVED' }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({
      pay_type: 'COMMISSION',
      commission_percent: null,
    });
  });

  it('approved requests show the rider type', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': (call) =>
        ok(
          page(
            call.query.status === 'APPROVED'
              ? [
                  application({ id: 'a1', approval_status: 'APPROVED', pay_type: 'COMMISSION', commission_percent: 70 }),
                  application({ id: 'a2', full_name: 'Kamal', approval_status: 'APPROVED', pay_type: 'COMPANY', commission_percent: null }),
                ]
              : []
          )
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Approved' }));
    const list = await screen.findByRole('list', { name: 'Rider requests' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Commission · 70%');
    expect(second).toHaveTextContent('Company');
  });

  it('needs a reason to reject, and sends it', async () => {
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application()])),
      'POST /admin/rider-applications/:id/reject': () => ok({ application: application({ approval_status: 'REJECTED' }) }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject rider request' });
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'No licence');
    await userEvent.click(confirm);

    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/reject')[0].body).toEqual({ reason: 'No licence' });
  });

  it('shows the API error when the list cannot load', async () => {
    renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => fail(500, 'INTERNAL_ERROR', 'Server down'),
    });
    expect(await screen.findByText(/The Blynk API had a problem/)).toBeInTheDocument();
  });
});
