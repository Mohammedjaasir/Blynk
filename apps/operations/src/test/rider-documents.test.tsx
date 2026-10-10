import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPrivateFile, tokenStore } from '../api/client';
import type { RiderApplication, RiderDocumentRequirement, StaffRiderDocument } from '../api/types';
import { formatDay } from '../lib/riderDocuments';
import { colomboDate } from '../lib/slots';
import { ADMIN_NO_RIDER, ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Rider documents in Operations (owner, 2026-10-10): thumbnails fetched
 * privately as Blobs, the viewer's Verify / Reject, Approve gated on
 * `documents_verified`, ADMIN-only "Approve anyway", Delete request, the
 * Settings -> Rider documents screen and the Riders list's expiry badges.
 * The API itself is tested in backend/api/tests/rider-documents.test.ts.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

let objectUrls = 0;
beforeEach(() => {
  objectUrls = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:doc-${++objectUrls}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Serves document pages as Blobs on top of helpers' JSON fake API (which has no `blob()`). */
function servePages(types: Record<string, string> = {}) {
  const inner = globalThis.fetch;
  const pageCalls: Array<{ path: string; auth: string | undefined }> = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const match = /\/admin\/rider-documents\/([^/]+)\/pages\/(\d)$/.exec(url.pathname);
    if (match) {
      pageCalls.push({ path: url.pathname.replace(/^\/api\/v1/, ''), auth: (init?.headers as Record<string, string>)?.Authorization });
      const blob = new Blob(['file'], { type: types[match[1]] ?? 'image/jpeg' });
      return { ok: true, status: 200, blob: async () => blob, text: async () => '' } as unknown as Response;
    }
    return inner(input, init);
  });
  vi.stubGlobal('fetch', spy);
  return pageCalls;
}

function doc(overrides: Partial<StaffRiderDocument> = {}): StaffRiderDocument {
  return {
    id: 'd-book',
    rider_id: 'r1',
    doc_type: 'VEHICLE_BOOK',
    label: 'Vehicle book (CR)',
    custom: false,
    pages: [{ index: 0, content_type: 'image/jpeg', bytes: 1000, uploaded_at: '2026-10-09T05:00:00.000Z' }],
    pages_needed: 1,
    expiry_date: null,
    expiry_state: null,
    status: 'PENDING',
    reject_reason: null,
    reject_reason_label: null,
    reject_note: null,
    reviewed_at: null,
    reviewed_by_name: null,
    updated_at: '2026-10-09T05:00:00.000Z',
    ...overrides,
  };
}

function requirement(overrides: Partial<RiderDocumentRequirement>): RiderDocumentRequirement {
  return {
    key: 'VEHICLE_BOOK',
    label: 'Vehicle book (CR)',
    required: true,
    needs_expiry: false,
    needs_back: false,
    document_id: null,
    status: 'MISSING',
    expiry_state: null,
    ...overrides,
  };
}

const BOOK = doc({ status: 'VERIFIED' });
const INSURANCE = doc({
  id: 'd-ins',
  doc_type: 'INSURANCE',
  label: 'Insurance certificate',
  pages: [{ index: 0, content_type: 'application/pdf', bytes: 2000, uploaded_at: '2026-10-09T05:00:00.000Z' }],
  expiry_date: '2026-10-25',
  expiry_state: 'EXPIRING',
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
    documents: [BOOK, INSURANCE],
    document_requirements: [
      requirement({ document_id: 'd-book', status: 'VERIFIED' }),
      requirement({
        key: 'INSURANCE',
        label: 'Insurance certificate',
        needs_expiry: true,
        document_id: 'd-ins',
        status: 'PENDING',
        expiry_state: 'EXPIRING',
      }),
      requirement({ key: 'DRIVING_LICENCE', label: 'Driving licence', needs_expiry: true, needs_back: true }),
    ],
    documents_blocking: [
      { key: 'INSURANCE', label: 'Insurance certificate', status: 'PENDING', expiry_state: 'EXPIRING' },
      { key: 'DRIVING_LICENCE', label: 'Driving licence', status: 'MISSING', expiry_state: null },
    ],
    documents_verified: false,
    ...overrides,
  };
}

const page = (applications: RiderApplication[]) => ({
  applications,
  pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
});

describe('Rider requests - documents (owner, 2026-10-10)', () => {
  it('shows thumbnails fetched privately as Blobs, statuses, Required and expiry; Approve stays disabled', async () => {
    renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application()])),
    });
    const pageCalls = servePages();

    const grid = await screen.findByRole('list', { name: 'Documents of Sunil Silva' });
    // The image page comes from a private fetch with the staff token, shown via an object URL.
    const img = await within(grid).findByRole('img', { name: 'Vehicle book (CR) front' });
    expect(img).toHaveAttribute('src', 'blob:doc-1');
    expect(pageCalls).toEqual([{ path: '/admin/rider-documents/d-book/pages/0', auth: 'Bearer test-access' }]);

    const tiles = within(grid).getAllByRole('listitem');
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveTextContent('Verified');
    // A PDF is a tile, not fetched for the thumbnail.
    expect(tiles[1]).toHaveTextContent('PDF');
    expect(tiles[1]).toHaveTextContent('Waiting review');
    expect(tiles[1]).toHaveTextContent('Expires 25 Oct 2026');
    expect(tiles[1]).toHaveTextContent('Expires soon');
    // Required but not uploaded.
    expect(tiles[2]).toHaveTextContent('Missing');
    expect(tiles[2]).toHaveTextContent('Not uploaded');
    expect(within(grid).getAllByText('Required')).toHaveLength(3);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(
      screen.getByText('Before approving, verify: Insurance certificate (waiting review), Driving licence (missing).')
    ).toBeInTheDocument();
    // OPERATIONS cannot override.
    expect(screen.queryByRole('button', { name: /Approve anyway/ })).toBeNull();
  });

  it('verifies a document with an expiry date picked in the calendar; Approve unlocks after the refresh', async () => {
    const user = userEvent.setup();
    let verified = false;
    const insuranceImage = { ...INSURANCE, expiry_date: null, expiry_state: null, pages: BOOK.pages };
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () =>
        ok(
          page([
            verified
              ? application({ documents: [BOOK, { ...insuranceImage, status: 'VERIFIED' }], documents_blocking: [], documents_verified: true })
              : application({ documents: [BOOK, insuranceImage] }),
          ])
        ),
      'POST /admin/rider-documents/:id/verify': (call) => {
        verified = true;
        return ok({ document: { ...insuranceImage, status: 'VERIFIED', expiry_date: call.body.expiry_date } });
      },
    });
    servePages();

    await user.click(await screen.findByRole('button', { name: 'Open Insurance certificate' }));
    const viewer = screen.getByRole('dialog', { name: 'Insurance certificate' });
    expect(await within(viewer).findByRole('img', { name: 'Insurance certificate front' })).toBeInTheDocument();

    // No date yet: refused before anything is sent.
    await user.click(within(viewer).getByRole('button', { name: 'Verify' }));
    expect(within(viewer).getByText('Pick the expiry date printed on the document first.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(0);

    // The styled calendar: next year, the 15th.
    await user.click(within(viewer).getByRole('button', { name: /Expiry date/ }));
    const calendar = within(viewer).getByRole('dialog', { name: 'Pick expiry date' });
    await user.click(within(calendar).getByRole('button', { name: 'Next year' }));
    const [y, m] = colomboDate(new Date()).split('-');
    const picked = `${Number(y) + 1}-${m}-15`;
    await user.click(within(calendar).getByRole('button', { name: formatDay(picked) }));
    expect(within(viewer).getByRole('button', { name: /Expiry date/ })).toHaveTextContent(formatDay(picked));

    await user.click(within(viewer).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')[0].body).toEqual({ expiry_date: picked });
    expect(await within(viewer).findByText('Insurance certificate is verified.')).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('explains DOCUMENT_INCOMPLETE / DOCUMENT_EXPIRED refusals', async () => {
    const user = userEvent.setup();
    let reply = 'DOCUMENT_INCOMPLETE';
    renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application({ documents: [doc()] })])),
      'POST /admin/rider-documents/:id/verify': () => ({ status: 409, error: { code: reply, message: reply } }),
    });
    servePages();
    await user.click(await screen.findByRole('button', { name: 'Open Vehicle book (CR)' }));
    const viewer = screen.getByRole('dialog', { name: 'Vehicle book (CR)' });
    await user.click(within(viewer).getByRole('button', { name: 'Verify' }));
    expect(await within(viewer).findByRole('alert')).toHaveTextContent('The back page is missing');
    reply = 'DOCUMENT_EXPIRED';
    await user.click(within(viewer).getByRole('button', { name: 'Verify' }));
    expect(await within(viewer).findByText(/already expired, so it cannot be verified/)).toBeInTheDocument();
  });

  it('rejects with a preset reason, and Other needs a note', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application({ documents: [doc(), INSURANCE] })])),
      'POST /admin/rider-documents/:id/reject': (call) =>
        ok({ document: doc({ status: 'REJECTED', reject_reason: call.body.reason, reject_reason_label: 'Blurry / hard to read' }) }),
    });
    servePages();

    await user.click(await screen.findByRole('button', { name: 'Open Vehicle book (CR)' }));
    let viewer = screen.getByRole('dialog', { name: 'Vehicle book (CR)' });
    await user.click(within(viewer).getByRole('button', { name: 'Reject' }));
    const confirm = within(viewer).getByRole('button', { name: 'Reject document' });
    expect(confirm).toBeDisabled();
    await user.click(within(viewer).getByRole('button', { name: 'Blurry' }));
    expect(within(viewer).getByRole('button', { name: 'Blurry' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(confirm);
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-book/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-documents/d-book/reject')[0].body).toEqual({ reason: 'BLURRY' });
    await user.click(within(viewer).getByRole('button', { name: 'Close' }));

    // Other: the note is required.
    await user.click(screen.getByRole('button', { name: 'Open Insurance certificate' }));
    viewer = screen.getByRole('dialog', { name: 'Insurance certificate' });
    await user.click(within(viewer).getByRole('button', { name: 'Reject' }));
    await user.click(within(viewer).getByRole('button', { name: 'Other' }));
    expect(within(viewer).getByRole('button', { name: 'Reject document' })).toBeDisabled();
    await user.type(within(viewer).getByLabelText(/Note for the rider \(required\)/), 'Wrong vehicle number');
    await user.click(within(viewer).getByRole('button', { name: 'Reject document' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-documents/d-ins/reject')[0].body).toEqual({
      reason: 'OTHER',
      note: 'Wrong vehicle number',
    });
  });

  it('an ADMIN can "Approve anyway" with a recorded reason', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_NO_RIDER, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([application()])),
      'POST /admin/rider-applications/:id/approve': () => ok({ application: application({ approval_status: 'APPROVED' }) }),
    });
    servePages();

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Approve anyway…' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    expect(within(dialog).getByRole('switch', { name: 'Approve anyway' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByText(/recorded with your name and reason/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Approve anyway' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason (recorded)'), 'Owner checked the papers in person');
    await user.click(confirm);

    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/r1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/r1/approve')[0].body).toEqual({
      pay_type: 'COMPANY',
      override_documents: true,
      override_reason: 'Owner checked the papers in person',
    });
  });

  it('deletes a request after confirmation', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page(deleted ? [] : [application()])),
      'DELETE /admin/rider-applications/:id': () => {
        deleted = true;
        return ok({ deleted: true, documents_removed: 2 });
      },
    });
    servePages();
    await user.click(await screen.findByRole('button', { name: 'Delete request' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this request?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete request' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/rider-applications/r1')).toHaveLength(1));
    expect(await screen.findByText(/Sunil Silva was deleted with 2 documents/)).toBeInTheDocument();
  });
});

describe('Settings -> Rider documents (owner, 2026-10-10)', () => {
  const BUILT_INS = [
    { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', needs_expiry: false, needs_back: false },
    { key: 'REVENUE_LICENCE', label: 'Revenue licence', needs_expiry: true, needs_back: false },
    { key: 'INSURANCE', label: 'Insurance certificate', needs_expiry: true, needs_back: false },
    { key: 'DRIVING_LICENCE', label: 'Driving licence', needs_expiry: true, needs_back: true },
  ].map((d) => ({ ...d, builtin: true, enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'] }));

  it('is linked from More', async () => {
    renderAs(OPERATIONS_STAFF, '/more', {});
    expect(await screen.findByRole('link', { name: 'Rider documents' })).toHaveAttribute('href', '/more/rider-documents');
  });

  it('toggles, refines vehicle types, adds a custom document and saves with PUT', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-documents', {
      'GET /admin/settings/rider-documents': () => ok({ settings: { documents: BUILT_INS, updated_at: null } }),
      'PUT /admin/settings/rider-documents': (call) =>
        ok({
          settings: {
            documents: call.body.documents.map((d: Record<string, unknown>) => ({
              builtin: Boolean(d.key),
              key: d.key ?? 'CUSTOM_ABCD1234',
              label: d.label ?? BUILT_INS.find((b) => b.key === d.key)!.label,
              ...d,
            })),
            updated_at: '2026-10-10T08:00:00.000Z',
          },
        }),
    });

    const list = await screen.findByRole('list', { name: 'Rider documents' });
    // Bicycle is off by default; motor vehicles on.
    const bookChips = within(list).getByRole('group', { name: 'Required for: Vehicle book (CR)' });
    expect(within(bookChips).getByRole('button', { name: 'Bicycle' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(bookChips).getByRole('button', { name: 'Car' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(bookChips).getByRole('button', { name: 'Bicycle' }));

    // Required off for the driving licence; Revenue licence hidden from the app.
    await user.click(within(list).getByRole('switch', { name: 'Required: Driving licence' }));
    expect(within(list).getByRole('switch', { name: 'Required: Driving licence' })).toHaveAttribute('aria-checked', 'false');
    await user.click(within(list).getByRole('switch', { name: 'Shown in the app: Revenue licence' }));
    await user.click(within(list).getByRole('switch', { name: 'Front and back: Insurance certificate' }));

    // A custom document.
    await user.type(screen.getByLabelText('Name'), 'Police report');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(within(list).getByRole('switch', { name: 'Required: Police report' }));
    await user.click(within(list).getByRole('switch', { name: 'Needs expiry date: Police report' }));

    await user.click(screen.getByRole('button', { name: 'Save rider documents' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(1));
    const motor = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'];
    expect(api.find('PUT', '/admin/settings/rider-documents')[0].body).toEqual({
      documents: [
        { key: 'VEHICLE_BOOK', enabled: true, required_for: [...motor, 'BICYCLE'], needs_expiry: false, needs_back: false },
        { key: 'REVENUE_LICENCE', enabled: false, required_for: motor, needs_expiry: true, needs_back: false },
        { key: 'INSURANCE', enabled: true, required_for: motor, needs_expiry: true, needs_back: true },
        { key: 'DRIVING_LICENCE', enabled: true, required_for: [], needs_expiry: true, needs_back: true },
        { label: 'Police report', enabled: true, required_for: motor, needs_expiry: true, needs_back: false },
      ],
    });
    expect(await screen.findByText(/Rider documents saved/)).toBeInTheDocument();
  });

  it('shows validation errors on the document they belong to, and removes a custom one', async () => {
    const user = userEvent.setup();
    const custom = { key: 'CUSTOM_1', label: 'Police report', builtin: false, enabled: true, required_for: [], needs_expiry: false, needs_back: false };
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-documents', {
      'GET /admin/settings/rider-documents': () =>
        ok({ settings: { documents: [...BUILT_INS, custom, { ...custom, key: 'CUSTOM_2', label: 'Grama Niladhari letter' }], updated_at: null } }),
      'PUT /admin/settings/rider-documents': () => ({
        status: 400,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [{ field: 'documents.4.label', message: 'This name is already used.' }],
        },
      }),
    });
    const list = await screen.findByRole('list', { name: 'Rider documents' });
    await user.click(within(list).getByRole('button', { name: 'Remove Grama Niladhari letter' }));
    expect(within(list).queryByText('Grama Niladhari letter')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save rider documents' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(1));
    const body = api.find('PUT', '/admin/settings/rider-documents')[0].body;
    expect(body.documents).toHaveLength(5);
    expect(body.documents[4]).toEqual({ key: 'CUSTOM_1', label: 'Police report', enabled: true, required_for: [], needs_expiry: false, needs_back: false });
    expect(await within(list).findByText('This name is already used.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This name is already used.');
  });
});

describe('Riders list - documents (owner, 2026-10-10)', () => {
  const RIDERS = [
    { id: 'r1', full_name: 'Farhan Mohamed', phone: '+94779876543', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-BCX-8842', open_deliveries: 0 },
    { id: 'r2', full_name: 'Nimal Perera', phone: '+94775551199', vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-AB-1', open_deliveries: 0 },
    { id: 'r3', full_name: 'Kamal', phone: '+94775551100', vehicle_type: 'CAR', vehicle_registration_number: 'WP-CA-1', open_deliveries: 0 },
  ];
  const alert = (rider_id: string, is_insurance: boolean, expiry_state: 'EXPIRED' | 'EXPIRING') => ({
    document_id: `doc-${rider_id}`,
    rider_id,
    full_name: null,
    phone: null,
    doc_type: is_insurance ? 'INSURANCE' : 'REVENUE_LICENCE',
    label: is_insurance ? 'Insurance certificate' : 'Revenue licence',
    is_insurance,
    status: 'VERIFIED',
    expiry_date: '2026-10-20',
    expiry_state,
  });

  it('badges expired / expiring insurance and other expiring documents by rider id', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: RIDERS }),
      'GET /admin/rider-documents/alerts': () =>
        ok({ warning_days: 30, alerts: [alert('r1', true, 'EXPIRED'), alert('r2', true, 'EXPIRING'), alert('r3', false, 'EXPIRING')] }),
    });
    const rows = await Promise.all(
      ['Farhan Mohamed', 'Nimal Perera', 'Kamal'].map(async (n) => (await screen.findByText(n)).closest('li') as HTMLElement)
    );
    await waitFor(() => expect(rows[0]).toHaveTextContent('Insurance expired'));
    expect(rows[1]).toHaveTextContent('Insurance expiring soon');
    expect(rows[1]).not.toHaveTextContent('Insurance expired');
    expect(rows[2]).toHaveTextContent('Documents expiring');
    expect(rows[2]).not.toHaveTextContent('Insurance');
  });

  it('opens a rider’s documents and re-verifies a renewed insurance', async () => {
    const user = userEvent.setup();
    const renewed = { ...INSURANCE, pages: BOOK.pages, expiry_date: '2027-10-01', expiry_state: 'OK' as const };
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: RIDERS.slice(0, 1) }),
      'GET /admin/rider-documents/alerts': () => ok({ warning_days: 30, alerts: [] }),
      'GET /admin/riders/:id/documents': () =>
        ok({
          rider: { id: 'r1', full_name: 'Farhan Mohamed', vehicle_type: 'MOTORCYCLE', approval_status: 'APPROVED' },
          documents: [BOOK, renewed],
          requirements: [
            requirement({ document_id: 'd-book', status: 'VERIFIED' }),
            requirement({ key: 'INSURANCE', label: 'Insurance certificate', needs_expiry: true, document_id: 'd-ins', status: 'PENDING' }),
          ],
          blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'PENDING', expiry_state: 'OK' }],
          all_required_verified: false,
        }),
      'POST /admin/rider-documents/:id/verify': () => ok({ document: { ...renewed, status: 'VERIFIED' } }),
    });
    servePages();

    await user.click(await screen.findByRole('button', { name: 'Documents for Farhan Mohamed' }));
    const sheet = screen.getByRole('dialog', { name: 'Documents of Farhan Mohamed' });
    expect(await within(sheet).findByText('Still to verify: Insurance certificate (waiting review).')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Open Insurance certificate' }));
    const viewer = screen.getByRole('dialog', { name: 'Insurance certificate' });
    // The stored expiry is pre-filled, so Verify sends it.
    expect(within(viewer).getByRole('button', { name: /Expiry date/ })).toHaveTextContent('1 Oct 2027');
    await user.click(within(viewer).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-documents/d-ins/verify')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-documents/d-ins/verify')[0].body).toEqual({ expiry_date: '2027-10-01' });
    // The sheet re-reads the rider's documents after the action.
    await waitFor(() => expect(api.find('GET', '/admin/riders/r1/documents').length).toBeGreaterThanOrEqual(2));
  });
});

describe('fetchPrivateFile (owner, 2026-10-10)', () => {
  it('sends the token, refreshes once on a 401 and returns the Blob', async () => {
    tokenStore.save('old-access', 'old-refresh');
    const blob = new Blob(['png'], { type: 'image/png' });
    const seen: Array<string | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, data: { access_token: 'new-access', refresh_token: 'new-refresh' } }),
          } as Response;
        }
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        seen.push(auth);
        if (auth === 'Bearer old-access') {
          return { ok: false, status: 401, text: async () => JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }) } as Response;
        }
        return { ok: true, status: 200, blob: async () => blob, text: async () => '' } as unknown as Response;
      })
    );
    await expect(fetchPrivateFile('/admin/rider-documents/d1/pages/0')).resolves.toBe(blob);
    expect(seen).toEqual(['Bearer old-access', 'Bearer new-access']);
  });

  it('turns an API error into an ApiError with its code', async () => {
    tokenStore.save('a', 'r');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ success: false, error: { code: 'DOCUMENT_FILE_MISSING', message: 'gone' } }),
      }))
    );
    await expect(fetchPrivateFile('/admin/rider-documents/d1/pages/1')).rejects.toMatchObject({ status: 404, code: 'DOCUMENT_FILE_MISSING' });
  });
});
