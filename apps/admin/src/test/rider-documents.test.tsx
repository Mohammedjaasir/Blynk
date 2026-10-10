import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { RiderRequests } from '../pages/RiderRequests';
import { Staff } from '../pages/Staff';
import { RiderDocumentsSettingsCard } from '../components/RiderDocumentsSettingsCard';
import { tokenStore } from '../api/client';
import type {
  RiderApplicationWithDocuments,
  RiderDocumentRequirement,
  RiderDocumentType,
  StaffRiderDocument,
} from '../api/riderDocuments';
import { colomboDateKey } from '../lib/schedule';
import { fail, ok, type Call, type Reply } from './mockApi';

/**
 * Rider documents in the Admin app (owner, 2026-10-10): thumbnails fetched
 * as private blobs, the viewer's verify (with expiry) and reject (preset
 * reasons), Approve locked until every required document is verified,
 * "Approve anyway" with an audited reason, deleting a request, the
 * expiring-insurance badge, and Settings -> Rider documents. The API is
 * tested in backend/api/tests/rider-documents.test.ts.
 */

type FileReply = { file: Blob };
type FullCall = Call & { headers: Record<string, string> };

/** Like mockApi, plus raw file replies (the private document pages) and request headers. */
function stubApi(handler: (call: FullCall) => Reply | FileReply | undefined) {
  const calls: FullCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const raw = init?.body;
      const call: FullCall = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^.*\/api\/v1/, ''),
        query: url.searchParams,
        body: raw ? JSON.parse(String(raw)) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const reply = handler(call) ?? fail(404, 'NOT_MOCKED');
      if ('file' in reply) {
        const file = reply.file;
        return { ok: true, status: 200, blob: async () => file, text: async () => '' } as unknown as Response;
      }
      const status = reply.status ?? 200;
      const envelope = status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
      return { ok: status < 400, status, text: async () => JSON.stringify(envelope) } as Response;
    })
  );
  return { calls, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

const NOW = '2026-10-10T04:00:00.000Z';

function doc(overrides: Partial<StaffRiderDocument> = {}): StaffRiderDocument {
  return {
    id: 'd-ins',
    rider_id: 'r1',
    doc_type: 'INSURANCE',
    label: 'Insurance certificate',
    custom: false,
    pages: [{ index: 0, content_type: 'image/jpeg', bytes: 1000, uploaded_at: NOW }],
    pages_needed: 1,
    expiry_date: null,
    expiry_state: null,
    status: 'PENDING',
    reject_reason: null,
    reject_reason_label: null,
    reject_note: null,
    reviewed_at: null,
    reviewed_by_name: null,
    updated_at: NOW,
    ...overrides,
  };
}

function req(overrides: Partial<RiderDocumentRequirement> = {}): RiderDocumentRequirement {
  return {
    key: 'INSURANCE',
    label: 'Insurance certificate',
    required: true,
    needs_expiry: true,
    needs_back: false,
    document_id: 'd-ins',
    status: 'PENDING',
    expiry_state: null,
    ...overrides,
  };
}

const licence = doc({
  id: 'd-dl',
  doc_type: 'DRIVING_LICENCE',
  label: 'Driving licence',
  pages: [
    { index: 0, content_type: 'application/pdf', bytes: 5000, uploaded_at: NOW },
    { index: 1, content_type: 'application/pdf', bytes: 5000, uploaded_at: NOW },
  ],
  pages_needed: 2,
  expiry_date: '2026-10-25',
  expiry_state: 'EXPIRING',
  status: 'VERIFIED',
});

/** Insurance (image, waiting review), driving licence (PDF, verified, expiring), vehicle book missing. */
function application(overrides: Partial<RiderApplicationWithDocuments> = {}): RiderApplicationWithDocuments {
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
    documents: [doc(), licence],
    document_requirements: [
      req({ key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', needs_expiry: false, document_id: null, status: 'MISSING' }),
      req(),
      req({ key: 'DRIVING_LICENCE', label: 'Driving licence', needs_back: true, document_id: 'd-dl', status: 'VERIFIED', expiry_state: 'EXPIRING' }),
    ],
    documents_blocking: [
      { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', status: 'MISSING', expiry_state: null },
      { key: 'INSURANCE', label: 'Insurance certificate', status: 'PENDING', expiry_state: null },
    ],
    documents_verified: false,
    ...overrides,
  };
}

const page = (applications: RiderApplicationWithDocuments[]) => ({
  applications,
  pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
});

const jpeg = () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
const pdfBlob = () => new Blob(['%PDF'], { type: 'application/pdf' });

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RiderRequests />
      </ToastProvider>
    </MemoryRouter>
  );
}

let created = 0;
const createObjectURL = vi.fn(() => `blob:doc-${++created}`);
const revokeObjectURL = vi.fn();

describe('Rider documents (owner, 2026-10-10)', () => {
  beforeEach(() => {
    tokenStore.save('access-token', 'refresh');
    created = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows each document as a thumbnail fetched privately, with status, Required and expiry chips', async () => {
    const api = stubApi((c) => {
      if (c.path === '/admin/rider-applications') return ok(page([application()]));
      if (c.path === '/admin/rider-documents/d-ins/pages/0') return { file: jpeg() };
      return undefined;
    });
    const view = renderPage();

    const insurance = await screen.findByTestId('doc-tile-INSURANCE');
    await waitFor(() => expect(insurance.querySelector('img')).toHaveAttribute('src', 'blob:doc-1'));
    expect(within(insurance).getByText('Waiting review')).toBeInTheDocument();
    expect(within(insurance).getByText('Required')).toBeInTheDocument();

    // The page is fetched with the staff token - there is no public URL.
    const fetched = api.find('GET', '/admin/rider-documents/d-ins/pages/0');
    expect(fetched).toHaveLength(1);
    expect(fetched[0].headers.Authorization).toBe('Bearer access-token');

    // A PDF is a styled tile (no fetch until opened), a missing required one says so.
    const dl = screen.getByTestId('doc-tile-DRIVING_LICENCE');
    expect(within(dl).getByText('PDF')).toBeInTheDocument();
    expect(within(dl).getByText('Verified')).toBeInTheDocument();
    expect(within(dl).getByText('Expires soon')).toBeInTheDocument();
    expect(within(dl).getByText('Expires 25 Oct 2026')).toBeInTheDocument();
    expect(api.find('GET', '/admin/rider-documents/d-dl/pages/0')).toHaveLength(0);
    const book = screen.getByTestId('doc-tile-VEHICLE_BOOK');
    expect(within(book).getByText('Missing')).toBeInTheDocument();
    expect(within(book).getByText('Not uploaded')).toBeInTheDocument();

    // Object URLs are revoked when the page goes away.
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:doc-1');
  });

  it('keeps Approve off until every required document is verified, listing what blocks it', async () => {
    const user = userEvent.setup();
    let verified = false;
    const api = stubApi((c) => {
      if (c.path === '/admin/rider-applications') {
        return ok(page([verified ? application({ documents_verified: true, documents_blocking: [] }) : application()]));
      }
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      if (c.method === 'POST' && c.path === '/admin/rider-documents/d-ins/verify') {
        verified = true;
        return ok({ document: doc({ status: 'VERIFIED', expiry_date: c.body.expiry_date, expiry_state: 'OK' }) });
      }
      return undefined;
    });
    renderPage();

    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(screen.getByTestId('blocking-r1')).toHaveTextContent(
      'Not verified yet: Vehicle book (CR) (missing), Insurance certificate (waiting review).'
    );

    // Verify the insurance with its expiry; the list refreshes.
    await user.click(screen.getByRole('button', { name: 'Open Insurance certificate' }));
    const viewer = screen.getByRole('dialog', { name: 'Insurance certificate - document viewer' });
    await user.click(within(viewer).getByRole('button', { name: 'Expiry date' }));
    await user.click(within(viewer).getByRole('button', { name: 'Next year' }));
    await user.click(within(viewer).getAllByRole('button', { name: /^15 / })[0]);
    await user.click(within(viewer).getByRole('button', { name: 'Verify ✓' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
    expect(screen.queryByTestId('blocking-r1')).toBeNull();
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(1);
  });

  it('verifies with the expiry date from the styled calendar, and explains the API refusals', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const api = stubApi((c) => {
      if (c.path === '/admin/rider-applications') return ok(page([application()]));
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      if (c.method === 'POST' && c.path === '/admin/rider-documents/d-ins/verify') {
        attempt += 1;
        if (attempt === 1) return fail(409, 'DOCUMENT_EXPIRED', 'expired');
        return ok({ document: doc({ status: 'VERIFIED', expiry_date: c.body.expiry_date, expiry_state: 'OK', updated_at: '2026-10-10T05:00:00.000Z' }) });
      }
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Open Insurance certificate' }));
    const viewer = screen.getByRole('dialog', { name: 'Insurance certificate - document viewer' });
    expect(await within(viewer).findByRole('img', { name: 'Insurance certificate, front' })).toHaveAttribute('src', expect.stringMatching(/^blob:/));

    // No expiry entered: asked for it, nothing sent.
    await user.click(within(viewer).getByRole('button', { name: 'Verify ✓' }));
    expect(within(viewer).getByRole('alert')).toHaveTextContent('Enter the expiry date printed on the document, then verify.');
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(0);

    // Pick next year's 15th in the calendar popover (not a native date input).
    expect(viewer.querySelector('input[type="date"]')).toBeNull();
    await user.click(within(viewer).getByRole('button', { name: 'Expiry date' }));
    const calendar = within(viewer).getByRole('dialog', { name: 'Expiry date calendar' });
    await user.click(within(calendar).getByRole('button', { name: 'Next year' }));
    await user.click(within(calendar).getAllByRole('button', { name: /^15 / })[0]);
    const today = colomboDateKey();
    const expected = `${Number(today.slice(0, 4)) + 1}-${today.slice(5, 7)}-15`;

    // First try: the API says it has expired -> clear words, Expired reason preselected.
    await user.click(within(viewer).getByRole('button', { name: 'Verify ✓' }));
    expect(await within(viewer).findByText(/This document has expired, so it cannot be verified/)).toBeInTheDocument();
    expect(within(viewer).getByRole('button', { name: 'Expired' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(viewer).getByRole('button', { name: 'Verify ✓' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(2));
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')[1].body).toEqual({ expiry_date: expected });
    expect(await within(viewer).findByTestId('viewer-status')).toHaveTextContent('Verified');

    // Escape closes the viewer.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /document viewer/ })).toBeNull();
  });

  it('explains EXPIRY_REQUIRED and DOCUMENT_INCOMPLETE from the API', async () => {
    const user = userEvent.setup();
    let tries = 0;
    stubApi((c) => {
      if (c.path === '/admin/rider-applications') return ok(page([application()]));
      if (c.path.endsWith('/pages/0') || c.path.endsWith('/pages/1')) return { file: pdfBlob() };
      if (c.path === '/admin/rider-documents/d-dl/verify') {
        tries += 1;
        return tries === 1 ? fail(400, 'EXPIRY_REQUIRED', 'expiry') : fail(409, 'DOCUMENT_INCOMPLETE', 'incomplete');
      }
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Open Driving licence' }));
    const viewer = screen.getByRole('dialog', { name: 'Driving licence - document viewer' });
    // A PDF opens in the viewer and in a new tab from its blob URL; front/back switch.
    expect(await within(viewer).findByTitle('Driving licence (PDF)')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(within(viewer).getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', expect.stringMatching(/^blob:/));
    await user.click(within(viewer).getByRole('button', { name: 'Back' }));
    expect(within(viewer).getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(viewer).getByRole('button', { name: /Verify again/ }));
    expect(await within(viewer).findByText('Enter the expiry date printed on the document, then verify.')).toBeInTheDocument();
    expect(within(viewer).getByRole('button', { name: /^Expiry date/ })).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(viewer).getByRole('button', { name: /Verify again/ }));
    expect(await within(viewer).findByText(/The back of this document is missing/)).toBeInTheDocument();
  });

  it('rejects with a preset reason, and Other needs a note', async () => {
    const user = userEvent.setup();
    const api = stubApi((c) => {
      if (c.path === '/admin/rider-applications') return ok(page([application()]));
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      if (c.method === 'POST' && c.path === '/admin/rider-documents/d-ins/reject') {
        return ok({ document: doc({ status: 'REJECTED', reject_reason: c.body.reason, reject_reason_label: 'Blurry / hard to read', updated_at: '2026-10-10T05:00:00.000Z' }) });
      }
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Open Insurance certificate' }));
    const viewer = screen.getByRole('dialog', { name: 'Insurance certificate - document viewer' });
    const reasons = within(viewer).getByRole('group', { name: 'Reject reason' });
    expect(within(reasons).getAllByRole('button').map((b) => b.textContent)).toEqual(['Blurry', 'Expired', 'Name mismatch', 'Wrong document', 'Other']);
    const rejectButton = within(viewer).getByRole('button', { name: 'Reject' });
    expect(rejectButton).toBeDisabled();

    await user.click(within(reasons).getByRole('button', { name: 'Blurry' }));
    await user.click(rejectButton);
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-documents/d-ins/reject')[0].body).toEqual({ reason: 'BLURRY' });

    // Other: the note is required.
    await user.click(within(reasons).getByRole('button', { name: 'Other' }));
    expect(within(viewer).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(viewer).getByLabelText('What is wrong? (required)'), 'Photo is of a different bike');
    await user.click(within(viewer).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/reject')).toHaveLength(2));
    expect(api.find('POST', '/admin/rider-documents/d-ins/reject')[1].body).toEqual({ reason: 'OTHER', note: 'Photo is of a different bike' });
  });

  it('"Approve anyway" needs a reason, warns about the audit log and sends the override', async () => {
    const user = userEvent.setup();
    const api = stubApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([application()]));
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      if (c.method === 'POST' && c.path === '/admin/rider-applications/r1/approve') return ok({ application: application({ approval_status: 'APPROVED' }) });
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve anyway' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve without verified documents?' });
    expect(within(dialog).getByText(/recorded in the audit log with your name/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Vehicle book \(CR\) \(missing\)/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Approve anyway' });
    expect(submit).toBeDisabled();
    // The pay type fields are still there.
    expect(within(dialog).getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true');

    await user.type(within(dialog).getByLabelText(/Reason for approving anyway/), 'CR at the RMV, seen the receipt');
    await user.click(submit);
    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({
      pay_type: 'COMPANY',
      commission_percent: null,
      override_documents: true,
      override_reason: 'CR at the RMV, seen the receipt',
    });
  });

  it('deletes a waiting request after confirming', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const api = stubApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page(deleted ? [] : [application()]));
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      if (c.method === 'DELETE' && c.path === '/admin/rider-applications/r1') {
        deleted = true;
        return ok({ deleted: true, documents_removed: 2 });
      }
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this request?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete request' }));
    expect(await screen.findByText('No rider requests waiting')).toBeInTheDocument();
    expect(api.find('DELETE', '/admin/rider-applications/r1')).toHaveLength(1);
  });

  it('badges approved riders with expiring insurance and opens their documents', async () => {
    const user = userEvent.setup();
    const approved = (id: string, name: string) =>
      application({ id, full_name: name, approval_status: 'APPROVED', pay_type: 'COMPANY', commission_percent: null, documents_verified: true });
    const api = stubApi((c) => {
      if (c.path === '/admin/rider-applications') {
        return ok(page(c.query.get('status') === 'APPROVED' ? [approved('r1', 'Sunil'), approved('r2', 'Kamal'), approved('r3', 'Nimal')] : []));
      }
      if (c.path === '/admin/rider-documents/alerts') {
        const base = { phone: null, status: 'VERIFIED', full_name: null, doc_type: 'INSURANCE', label: 'Insurance certificate' };
        return ok({
          warning_days: 30,
          alerts: [
            { ...base, document_id: 'a1', rider_id: 'r1', is_insurance: true, expiry_date: '2026-10-01', expiry_state: 'EXPIRED' },
            { ...base, document_id: 'a2', rider_id: 'r2', is_insurance: true, expiry_date: '2026-10-20', expiry_state: 'EXPIRING' },
            { ...base, document_id: 'a3', rider_id: 'r3', is_insurance: false, doc_type: 'REVENUE_LICENCE', label: 'Revenue licence', expiry_date: '2026-10-28', expiry_state: 'EXPIRING' },
          ],
        });
      }
      if (c.path === '/admin/riders/r1/documents') {
        return ok({
          rider: { id: 'r1', full_name: 'Sunil', vehicle_type: 'MOTORCYCLE', approval_status: 'APPROVED' },
          documents: [doc({ status: 'VERIFIED', expiry_date: '2026-10-01', expiry_state: 'EXPIRED' })],
          requirements: [req({ status: 'VERIFIED', expiry_state: 'EXPIRED' })],
          blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'VERIFIED', expiry_state: 'EXPIRED' }],
          all_required_verified: false,
        });
      }
      if (c.path.endsWith('/pages/0')) return { file: jpeg() };
      return undefined;
    });
    renderPage();
    await screen.findByText('No rider requests waiting');
    await user.click(screen.getByRole('button', { name: 'Approved' }));

    const table = await screen.findByRole('table', { name: 'Rider requests' });
    const rows = within(table).getAllByRole('row');
    expect(await within(rows[1]).findByText('Insurance expired')).toHaveClass('rd-chip--danger');
    expect(within(rows[2]).getByText('Insurance expiring soon')).toHaveClass('rd-chip--warn');
    expect(within(rows[3]).getByText('Documents expiring')).toHaveClass('rd-chip--soft');

    await user.click(within(rows[1]).getByRole('button', { name: 'Documents' }));
    const panel = await screen.findByRole('dialog', { name: 'Documents: Sunil' });
    expect(await within(panel).findByText(/Not verified yet: Insurance certificate \(expired\)/)).toBeInTheDocument();
    expect(within(panel).getByTestId('doc-tile-INSURANCE')).toHaveTextContent('Expired');
    expect(api.find('GET', '/admin/riders/r1/documents')).toHaveLength(1);
    // Re-verify is allowed for an approved rider (a renewed insurance).
    await user.click(within(panel).getByRole('button', { name: 'Open Insurance certificate' }));
    expect(screen.getByRole('dialog', { name: 'Insurance certificate - document viewer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify again ✓' })).toBeEnabled();
  });
});

// ------------------------------------------------------------- settings
const builtins: RiderDocumentType[] = [
  { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', builtin: true, enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: false, needs_back: false },
  { key: 'REVENUE_LICENCE', label: 'Revenue licence', builtin: true, enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: false },
  { key: 'INSURANCE', label: 'Insurance certificate', builtin: true, enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: false },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', builtin: true, enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: true },
];

describe('Settings -> Rider documents (owner, 2026-10-10)', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  const renderCard = () =>
    render(
      <ToastProvider>
        <RiderDocumentsSettingsCard />
      </ToastProvider>
    );

  it('toggles requirements per document and vehicle, adds a custom one, and PUTs the whole list', async () => {
    const user = userEvent.setup();
    const api = stubApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/rider-documents') return ok({ settings: { documents: builtins, updated_at: null } });
      if (c.method === 'PUT' && c.path === '/admin/settings/rider-documents') {
        return ok({ settings: { documents: builtins, updated_at: '2026-10-10T05:00:00.000Z' } });
      }
      return undefined;
    });
    renderCard();

    const insurance = await screen.findByRole('group', { name: 'Insurance certificate' });
    // Styled switches, not native checkboxes.
    expect(within(insurance).getByRole('switch', { name: 'Required: Insurance certificate' })).toHaveAttribute('aria-checked', 'true');
    expect(insurance.querySelector('input[type="checkbox"]')).toBeNull();

    // Required off = required for nobody.
    await user.click(within(insurance).getByRole('switch', { name: 'Required: Insurance certificate' }));
    expect(within(insurance).getByText('Optional for everyone')).toBeInTheDocument();

    // Vehicle chips refine it: bicycles too for the vehicle book; cars not.
    const book = screen.getByRole('group', { name: 'Vehicle book (CR)' });
    const bookVehicles = within(book).getByRole('group', { name: 'Required for: Vehicle book (CR)' });
    expect(within(bookVehicles).getByRole('button', { name: 'Bicycle' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(bookVehicles).getByRole('button', { name: 'Bicycle' }));
    await user.click(within(bookVehicles).getByRole('button', { name: 'Car' }));

    const revenue = screen.getByRole('group', { name: 'Revenue licence' });
    await user.click(within(revenue).getByRole('switch', { name: 'Front and back: Revenue licence' }));
    const licence = screen.getByRole('group', { name: 'Driving licence' });
    await user.click(within(licence).getByRole('switch', { name: 'Shown in the app: Driving licence' }));
    expect(within(licence).getByText(/Hidden: riders are not asked for it/)).toBeInTheDocument();

    // A custom document by name; too short is refused.
    await user.type(screen.getByLabelText(/Add a document/), 'P');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Give the document a name (at least 2 characters).')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Add a document/), 'olice report');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const custom = screen.getByRole('group', { name: 'Police report' });
    await user.click(within(custom).getByRole('switch', { name: 'Required: Police report' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/rider-documents')[0].body).toEqual({
      documents: [
        { key: 'VEHICLE_BOOK', enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'BICYCLE'], needs_expiry: false, needs_back: false },
        { key: 'REVENUE_LICENCE', enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: true },
        { key: 'INSURANCE', enabled: true, required_for: [], needs_expiry: true, needs_back: false },
        { key: 'DRIVING_LICENCE', enabled: false, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: true },
        { label: 'Police report', enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: false, needs_back: false },
      ],
    });
    expect(await screen.findByText('Rider documents saved.')).toBeInTheDocument();
  });

  it('shows the API validation error on the document it belongs to, and removes a custom one', async () => {
    const user = userEvent.setup();
    const withCustom: RiderDocumentType[] = [
      ...builtins,
      { key: 'CUSTOM_AB12CD34', label: 'Police report', builtin: false, enabled: true, required_for: [], needs_expiry: false, needs_back: false },
      { key: 'CUSTOM_EF56GH78', label: 'Grama Niladhari letter', builtin: false, enabled: true, required_for: [], needs_expiry: false, needs_back: false },
    ];
    let puts = 0;
    const api = stubApi((c) => {
      if (c.method === 'GET') return ok({ settings: { documents: withCustom, updated_at: null } });
      if (c.method === 'PUT') {
        puts += 1;
        return puts === 1
          ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'documents.4.label', message: 'That name is already used.' }])
          : ok({ settings: { documents: builtins, updated_at: null } });
      }
      return undefined;
    });
    renderCard();

    await screen.findByRole('group', { name: 'Police report' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const police = screen.getByRole('group', { name: 'Police report' });
    expect(await within(police).findByText('That name is already used.')).toBeInTheDocument();
    expect(screen.getByText('Check the highlighted fields.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('group', { name: 'Grama Niladhari letter' })).getByRole('button', { name: 'Remove Grama Niladhari letter' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(2));
    const sent = api.find('PUT', '/admin/settings/rider-documents')[1].body.documents;
    expect(sent).toHaveLength(5);
    expect(sent[4]).toEqual({ key: 'CUSTOM_AB12CD34', label: 'Police report', enabled: true, required_for: [], needs_expiry: false, needs_back: false });
  });
});

describe('Staff -> rider accounts (owner, 2026-10-10)', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it("shows a rider account's insurance badge and opens its documents", async () => {
    const user = userEvent.setup();
    const riderRow = {
      id: 'u9',
      full_name: 'Ruwan Rider',
      email: 'ruwan@blynk.lk',
      phone: '+94770000009',
      role: 'RIDER',
      has_password: true,
      disabled: false,
      read_only: false,
      created_at: '2026-09-29T04:30:00.000Z',
      rider: { id: 'rr9', is_active: true, vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP CAB-9999' },
    };
    const api = stubApi((c) => {
      if (c.path === '/admin/staff') return ok({ staff: [riderRow] });
      if (c.path === '/admin/rider-documents/alerts') {
        return ok({
          warning_days: 30,
          alerts: [
            { document_id: 'a1', rider_id: 'rr9', full_name: 'Ruwan Rider', phone: null, doc_type: 'INSURANCE', label: 'Insurance certificate', is_insurance: true, status: 'VERIFIED', expiry_date: '2026-10-20', expiry_state: 'EXPIRING' },
          ],
        });
      }
      if (c.path === '/admin/riders/rr9/documents') {
        return ok({
          rider: { id: 'rr9', full_name: 'Ruwan Rider', vehicle_type: 'MOTORCYCLE', approval_status: 'APPROVED' },
          documents: [],
          requirements: [req({ document_id: null, status: 'MISSING' })],
          blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'MISSING', expiry_state: null }],
          all_required_verified: false,
        });
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Staff />
        </ToastProvider>
      </MemoryRouter>
    );

    const table = await screen.findByRole('table', { name: 'Staff accounts' });
    expect(await within(table).findByText('Insurance expiring soon')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Documents' }));
    const panel = await screen.findByRole('dialog', { name: 'Documents: Ruwan Rider' });
    expect(await within(panel).findByText(/Not verified yet: Insurance certificate \(missing\)/)).toBeInTheDocument();
    expect(api.find('GET', '/admin/riders/rr9/documents')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Documents: Ruwan Rider' })).toBeNull();
  });
});
