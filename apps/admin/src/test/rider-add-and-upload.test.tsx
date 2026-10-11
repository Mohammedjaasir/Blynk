import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { RiderRequests } from '../pages/RiderRequests';
import { Staff } from '../pages/Staff';
import { RiderDocumentsSettingsCard } from '../components/RiderDocumentsSettingsCard';
import { RiderDocumentsPanel } from '../components/RiderDocuments';
import { tokenStore } from '../api/client';
import type { RiderApplicationWithDocuments, RiderDocumentType, StaffRiderDocument } from '../api/riderDocuments';
import { colomboDateKey } from '../lib/schedule';
import { fail, mockApi, ok } from './mockApi';

/**
 * (owner, 2026-10-11: "Mainly I am going to approve the drivers manually;
 * they will send docs on WhatsApp" / "Add a delivery rider and I upload the
 * things"): the two Settings switches, the "Add rider" form (validation,
 * POST body with pay, page uploads with the expiry, approve when the server
 * did not), and staff upload / replace / remove / expiry for existing
 * riders. The API is tested in the backend suite.
 */

const NOW = '2026-10-11T04:00:00.000Z';
const MOTOR = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'] as const;

const types: RiderDocumentType[] = [
  { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', builtin: true, enabled: true, required_for: [...MOTOR], needs_expiry: false, needs_back: false },
  { key: 'INSURANCE', label: 'Insurance certificate', builtin: true, enabled: true, required_for: [...MOTOR], needs_expiry: true, needs_back: false },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', builtin: true, enabled: true, required_for: [...MOTOR], needs_expiry: true, needs_back: true },
  { key: 'REVENUE_LICENCE', label: 'Revenue licence', builtin: true, enabled: false, required_for: [...MOTOR], needs_expiry: true, needs_back: false },
];

const settings = (over: Record<string, unknown> = {}) => ({
  settings: { documents: types, applicant_uploads_enabled: false, require_documents_for_approval: true, updated_at: null, ...over },
});

function doc(overrides: Partial<StaffRiderDocument> = {}): StaffRiderDocument {
  return {
    id: 'd-book',
    rider_id: 'r1',
    doc_type: 'VEHICLE_BOOK',
    label: 'Vehicle book (CR)',
    custom: false,
    pages: [{ index: 0, content_type: 'image/jpeg', bytes: 1000, uploaded_at: NOW }],
    pages_needed: 1,
    expiry_date: null,
    expiry_state: null,
    status: 'VERIFIED',
    reject_reason: null,
    reject_reason_label: null,
    reject_note: null,
    reviewed_at: NOW,
    reviewed_by_name: 'Admin',
    updated_at: NOW,
    ...overrides,
  };
}

const riderRow = (over: Record<string, unknown> = {}) => ({
  id: 'r9',
  user_id: 'u9',
  full_name: 'Kamal Perera',
  phone: '+94771234567',
  vehicle_type: 'MOTORCYCLE',
  vehicle_registration_number: 'WP BCX-8842',
  emergency_contact_phone: null,
  approval_status: 'PENDING',
  applied_at: NOW,
  reviewed_at: null,
  reviewed_by_name: null,
  rejection_reason: null,
  pay_type: 'COMMISSION',
  commission_percent: null,
  pay_model: 'FIXED',
  ...over,
});

const page = (applications: unknown[]) => ({
  applications,
  pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
});

const jpeg = (name = 'photo.jpg') => new File(['jpeg-bytes'], name, { type: 'image/jpeg' });
const pdf = (name = 'scan.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });

/** Picks a file on one of the hidden inputs behind "Choose file" / "Take photo". */
function pickFile(testId: string, file: File) {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
}

/** Next year's 15th of this month in the styled calendar. */
async function pickExpiry(user: ReturnType<typeof userEvent.setup>, label: string): Promise<string> {
  await user.click(screen.getByRole('button', { name: label }));
  const calendar = screen.getByRole('dialog', { name: `${label} calendar` });
  await user.click(within(calendar).getByRole('button', { name: 'Next year' }));
  await user.click(within(calendar).getAllByRole('button', { name: /^15 / })[0]);
  const today = colomboDateKey();
  return `${Number(today.slice(0, 4)) + 1}-${today.slice(5, 7)}-15`;
}

function renderRequests() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RiderRequests />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  tokenStore.save('access', 'refresh');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------- settings
describe('Settings -> Rider documents switches (owner, 2026-10-11)', () => {
  it('shows both switches with their explanations and saves them with the list', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path !== '/admin/settings/rider-documents') return undefined;
      if (c.method === 'GET') return ok(settings());
      return ok(settings({ applicant_uploads_enabled: c.body.applicant_uploads_enabled, require_documents_for_approval: c.body.require_documents_for_approval }));
    });
    render(
      <ToastProvider>
        <RiderDocumentsSettingsCard />
      </ToastProvider>
    );

    const uploads = await screen.findByRole('switch', { name: 'Riders upload documents in the app' });
    const approval = screen.getByRole('switch', { name: 'Documents needed before approval' });
    expect(uploads).toHaveAttribute('aria-checked', 'false');
    expect(approval).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('uploads-explainer')).toHaveTextContent(/WhatsApp \(\+94 71 710 7374\)/);
    expect(screen.getByTestId('approval-explainer')).toHaveTextContent(/Approve anyway/);
    // The site's own switches, not native checkboxes.
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();

    await user.click(uploads);
    await user.click(approval);
    expect(screen.getByTestId('uploads-explainer')).toHaveTextContent('On: applicants photograph and upload each document in the Rider app.');
    expect(screen.getByTestId('approval-explainer')).toHaveTextContent('Off: riders can be approved without documents.');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(1));
    const body = api.find('PUT', '/admin/settings/rider-documents')[0].body;
    expect(body.applicant_uploads_enabled).toBe(true);
    expect(body.require_documents_for_approval).toBe(false);
    expect(body.documents).toHaveLength(4);
    expect(await screen.findByText('Rider documents saved.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Riders upload documents in the app' })).toHaveAttribute('aria-checked', 'true');
  });
});

// ------------------------------------------------------------- add rider
describe('Add rider (owner, 2026-10-11)', () => {
  type Opts = {
    create?: () => ReturnType<typeof ok>;
    upload?: (path: string) => ReturnType<typeof ok>;
    approve?: () => ReturnType<typeof ok>;
    docSettings?: ReturnType<typeof settings>;
  };
  function api(opts: Opts = {}) {
    return mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([]));
      if (c.method === 'GET' && c.path === '/admin/settings/rider-documents') return ok(opts.docSettings ?? settings());
      if (c.method === 'POST' && c.path === '/admin/riders') {
        return opts.create ? opts.create() : ok({ rider: riderRow(), approved: false, documents_blocking: [], from: 'NEW_NUMBER' });
      }
      if (c.method === 'PUT' && c.path.startsWith('/admin/riders/r9/documents/')) {
        return opts.upload ? opts.upload(c.path) : ok({ document: doc() });
      }
      if (c.method === 'POST' && c.path === '/admin/rider-applications/r9/approve') {
        return opts.approve ? opts.approve() : ok({ application: riderRow({ approval_status: 'APPROVED' }) });
      }
      return undefined;
    });
  }

  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    renderRequests();
    await user.click(await screen.findByRole('button', { name: 'Add rider' }));
    const dialog = screen.getByRole('dialog', { name: 'Add rider' });
    await within(dialog).findByRole('group', { name: 'Document: Insurance certificate' });
    return dialog;
  }

  async function fillDetails(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.type(within(dialog).getByLabelText('Full name'), 'Kamal Perera');
    await user.type(within(dialog).getByLabelText(/^Phone/), '077 123 4567');
    await user.type(within(dialog).getByLabelText('Registration number'), 'WP BCX-8842');
  }

  it('checks the details first, hides the number plate for a bicycle, and marks Required per vehicle', async () => {
    const user = userEvent.setup();
    const calls = api();
    const dialog = await openForm(user);

    // Only the documents shown in the app; Required follows the vehicle.
    expect(within(dialog).queryByRole('group', { name: 'Document: Revenue licence' })).toBeNull();
    const insurance = within(dialog).getByRole('group', { name: 'Document: Insurance certificate' });
    expect(within(insurance).getByText('Required')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Driving licence, back' })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Phone/), '12345');
    await user.type(within(dialog).getByLabelText(/Emergency contact phone/), '0111');
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(within(dialog).getByText('Enter their full name.')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Enter a Sri Lankan mobile number, e.g. 077 123 4567.')).toHaveLength(2);
    expect(within(dialog).getByText('Enter the number plate.')).toBeInTheDocument();
    expect(calls.find('POST', '/admin/riders')).toHaveLength(0);

    // A bicycle has no number plate, and the documents are optional for it.
    await user.click(within(dialog).getByRole('button', { name: 'Bicycle' }));
    expect(within(dialog).queryByLabelText('Registration number')).toBeNull();
    expect(within(insurance).getByText('Optional')).toBeInTheDocument();
  });

  it('adds the rider with pay, uploads each page front first with the expiry, then approves', async () => {
    const user = userEvent.setup();
    const calls = api();
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.type(within(dialog).getByLabelText(/Emergency contact phone/), '0712223333');

    // Commission, fixed LKR per delivery (the shared RiderPayFields).
    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    await user.click(within(dialog).getByRole('button', { name: 'Fixed' }));
    const fixed = within(dialog).getByLabelText(/^LKR per delivery/);
    await user.clear(fixed);
    await user.type(fixed, '150');

    pickFile('add-VEHICLE_BOOK-0-file', jpeg('cr.jpg'));
    pickFile('add-INSURANCE-0-camera', jpeg('insurance.jpg'));
    const insuranceExpiry = await pickExpiry(user, 'Expiry date: Insurance certificate');
    pickFile('add-DRIVING_LICENCE-0-file', pdf('dl-front.pdf'));
    pickFile('add-DRIVING_LICENCE-1-file', pdf('dl-back.pdf'));
    expect(within(dialog).getByText(/dl-back\.pdf/)).toBeInTheDocument();

    // A document needing an expiry is held back until it has one.
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(within(dialog).getByText('Enter the expiry date printed on it (or remove the file).')).toBeInTheDocument();
    expect(calls.find('POST', '/admin/riders')).toHaveLength(0);
    const licenceExpiry = await pickExpiry(user, 'Expiry date: Driving licence');

    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(await screen.findByText('Rider added. They can sign in to the Blynk Rider app with 077 123 4567 now.')).toBeInTheDocument();

    expect(calls.find('POST', '/admin/riders')[0].body).toEqual({
      full_name: 'Kamal Perera',
      phone: '077 123 4567',
      vehicle_type: 'MOTORCYCLE',
      vehicle_registration_number: 'WP BCX-8842',
      emergency_contact_phone: '0712223333',
      pay_type: 'COMMISSION',
      pay_model: 'FIXED',
      fixed_lkr: 150,
      min_lkr: null,
    });

    const puts = calls.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.path)).toEqual([
      '/admin/riders/r9/documents/VEHICLE_BOOK/pages/0',
      '/admin/riders/r9/documents/INSURANCE/pages/0',
      '/admin/riders/r9/documents/DRIVING_LICENCE/pages/0',
      '/admin/riders/r9/documents/DRIVING_LICENCE/pages/1',
    ]);
    // Multipart: the file, and the expiry with the front page only.
    const form = (i: number) => puts[i].body as FormData;
    expect(form(0)).toBeInstanceOf(FormData);
    expect((form(0).get('file') as File).name).toBe('cr.jpg');
    expect(form(0).get('expiry_date')).toBeNull();
    expect(form(1).get('expiry_date')).toBe(insuranceExpiry);
    expect(form(2).get('expiry_date')).toBe(licenceExpiry);
    expect((form(3).get('file') as File).name).toBe('dl-back.pdf');
    expect(form(3).get('expiry_date')).toBeNull();

    // approved: false -> approve with the stored pay ({}), after the uploads.
    const approve = calls.find('POST', '/admin/rider-applications/r9/approve');
    expect(approve).toHaveLength(1);
    expect(approve[0].body).toEqual({});
    expect(calls.calls.indexOf(approve[0])).toBeGreaterThan(calls.calls.indexOf(puts[3]));
    expect(screen.queryByRole('dialog', { name: 'Add rider' })).toBeNull();
    // The list reloads.
    expect(calls.find('GET', '/admin/rider-applications').length).toBeGreaterThanOrEqual(2);
  });

  it('does not approve again when the server approved at once', async () => {
    const user = userEvent.setup();
    const calls = api({
      create: () => ok({ rider: riderRow({ approval_status: 'APPROVED' }), approved: true, documents_blocking: [], from: 'CUSTOMER' }),
      docSettings: settings({ require_documents_for_approval: false }),
    });
    const dialog = await openForm(user);
    expect(within(dialog).getByTestId('add-rider-docs-note')).toHaveTextContent(/not needed for approval/);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(await screen.findByText(/Rider added\. They can sign in .* 077 123 4567 now\. Their customer account stays/)).toBeInTheDocument();
    expect(calls.find('POST', '/admin/rider-applications/r9/approve')).toHaveLength(0);
    expect(calls.find('POST', '/admin/riders')[0].body).toMatchObject({ pay_type: 'COMPANY', commission_percent: null });
  });

  it('says the rider waits under Rider requests when approval is refused for documents', async () => {
    const user = userEvent.setup();
    api({
      approve: () =>
        fail(409, 'DOCUMENTS_NOT_VERIFIED', 'docs', {
          blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'MISSING', expiry_state: null }],
        }),
    });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    const notice = await screen.findByTestId('add-rider-notice');
    expect(notice).toHaveTextContent('Kamal Perera was saved and waits under Rider requests for: Insurance certificate (missing).');
    expect(notice).toHaveTextContent(/Approve anyway/);
  });

  it('keeps the rider when an upload fails, names the document and skips approval', async () => {
    const user = userEvent.setup();
    const calls = api({ upload: (path) => (path.includes('INSURANCE') ? fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'nope') : ok({ document: doc() })) });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    pickFile('add-VEHICLE_BOOK-0-file', jpeg());
    pickFile('add-INSURANCE-0-file', jpeg());
    await pickExpiry(user, 'Expiry date: Insurance certificate');
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));

    const notice = await screen.findByTestId('add-rider-notice');
    expect(notice).toHaveTextContent(/Kamal Perera was saved, but these documents did not upload: Insurance certificate \(Use a JPEG/);
    expect(notice).toHaveTextContent(/Open their documents to try again/);
    expect(calls.find('POST', '/admin/rider-applications/r9/approve')).toHaveLength(0);
    expect(within(notice).getByRole('button', { name: 'Open documents' })).toBeInTheDocument();
  });

  it('refuses files over 8 MB and HEIC photos before uploading', async () => {
    const user = userEvent.setup();
    api();
    const dialog = await openForm(user);
    const big = jpeg('huge.jpg');
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    pickFile('add-VEHICLE_BOOK-0-file', big);
    expect(within(dialog).getByText(/This file is 9\.0 MB\. Documents must be 8 MB or smaller/)).toBeInTheDocument();
    pickFile('add-VEHICLE_BOOK-0-camera', new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' }));
    expect(within(dialog).getByText(/HEIC photos are not accepted/)).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Vehicle book (CR), front' })).toHaveTextContent('No file');
  });

  it.each([
    ['STAFF_CAN_DELIVER', /Turn on "Can deliver" for them under Staff/],
    ['PHONE_IN_USE', /belongs to a staff or admin account/],
    ['ACCOUNT_DISABLED', /is disabled/],
    ['ALREADY_APPROVED', /This number is already a rider\./],
  ])('explains %s from the API next to the phone', async (code, text) => {
    const user = userEvent.setup();
    const calls = api({ create: () => fail(409, code, code) });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
    expect(calls.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('shows the API validation details on their fields', async () => {
    const user = userEvent.setup();
    api({ create: () => fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'vehicle_registration_number', message: 'Too long for a plate.' }]) });
    const dialog = await openForm(user);
    await fillDetails(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Add rider' }));
    expect(await within(dialog).findByText('Too long for a plate.')).toBeInTheDocument();
  });

  it('is on the Staff page too', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.path === '/admin/staff') return ok({ staff: [] });
      if (c.path === '/admin/settings/rider-documents') return ok(settings());
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Staff />
        </ToastProvider>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: 'Add rider' }));
    expect(screen.getByRole('dialog', { name: 'Add rider' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- staff upload for existing riders
describe('Staff upload in the documents panel (owner, 2026-10-11)', () => {
  const pending = (docs: StaffRiderDocument[]): RiderApplicationWithDocuments =>
    ({
      ...riderRow({ id: 'r1', full_name: 'Sunil Silva' }),
      documents: docs,
      document_requirements: [
        { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', required: true, needs_expiry: false, needs_back: false, document_id: docs[0]?.id ?? null, status: docs[0]?.status ?? 'MISSING', expiry_state: null },
        { key: 'INSURANCE', label: 'Insurance certificate', required: true, needs_expiry: true, needs_back: false, document_id: null, status: 'MISSING', expiry_state: null },
      ],
      documents_blocking: [],
      documents_verified: docs.length > 0,
      approval_needs_documents: true,
    }) as RiderApplicationWithDocuments;

  it('uploads a missing document for a waiting applicant and refreshes the list', async () => {
    const user = userEvent.setup();
    let uploaded = false;
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([pending(uploaded ? [doc({ rider_id: 'r1' })] : [])]));
      if (c.method === 'PUT' && c.path === '/admin/riders/r1/documents/VEHICLE_BOOK/pages/0') {
        uploaded = true;
        return ok({ document: doc({ rider_id: 'r1' }) });
      }
      return undefined;
    });
    renderRequests();

    await user.click(await screen.findByRole('button', { name: 'Upload Vehicle book (CR)' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload Vehicle book (CR)' });
    expect(within(dialog).getByTestId('upload-status')).toHaveTextContent('Missing');
    expect(within(dialog).getByRole('button', { name: 'Choose file: Vehicle book (CR), front' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Take photo: Vehicle book (CR), front' })).toBeInTheDocument();

    pickFile('upload-VEHICLE_BOOK-0-file', jpeg('cr.jpg'));
    await waitFor(() => expect(calls.find('PUT', '/admin/riders/r1/documents/VEHICLE_BOOK/pages/0')).toHaveLength(1));
    const form = calls.find('PUT', '/admin/riders/r1/documents/VEHICLE_BOOK/pages/0')[0].body as FormData;
    expect((form.get('file') as File).name).toBe('cr.jpg');
    expect(form.get('expiry_date')).toBeNull();
    expect(await within(dialog).findByTestId('upload-status')).toHaveTextContent('Verified');
    expect(await screen.findByText('Vehicle book (CR): front uploaded and verified.')).toBeInTheDocument();
    // The list refreshed: the tile now offers Replace.
    expect(await screen.findByRole('button', { name: 'Replace Vehicle book (CR)' })).toBeInTheDocument();
  });

  it('sends the expiry with the front, edits the expiry and removes a page for an approved rider', async () => {
    const user = userEvent.setup();
    let insurance: StaffRiderDocument | null = null;
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/riders/r5/documents') {
        return ok({
          rider: { id: 'r5', full_name: 'Nimal', vehicle_type: 'MOTORCYCLE', approval_status: 'APPROVED' },
          documents: insurance ? [insurance] : [],
          requirements: [
            { key: 'INSURANCE', label: 'Insurance certificate', required: true, needs_expiry: true, needs_back: false, document_id: insurance?.id ?? null, status: insurance?.status ?? 'MISSING', expiry_state: null },
          ],
          blocking: [],
          all_required_verified: true,
          approval_needs_documents: false,
        });
      }
      if (c.method === 'PUT' && c.path === '/admin/riders/r5/documents/INSURANCE/pages/0') {
        insurance = doc({ id: 'd-ins', rider_id: 'r5', doc_type: 'INSURANCE', label: 'Insurance certificate', expiry_date: c.body.get('expiry_date'), status: 'VERIFIED' });
        return ok({ document: insurance });
      }
      if (c.method === 'PATCH' && c.path === '/admin/riders/r5/documents/INSURANCE') {
        insurance = { ...insurance!, expiry_date: c.body.expiry_date, updated_at: '2026-10-11T05:00:00.000Z' };
        return ok({ document: insurance });
      }
      if (c.method === 'DELETE' && c.path === '/admin/riders/r5/documents/INSURANCE/pages/0') {
        insurance = null;
        return ok({ document: null });
      }
      return undefined;
    });
    // The Documents panel of an approved rider (Rider requests -> Approved).
    render(
      <ToastProvider>
        <RiderDocumentsPanel riderId="r5" riderName="Nimal" onClose={() => undefined} />
      </ToastProvider>
    );
    expect(await screen.findByText('Documents are not needed for approval (Settings, Rider documents).')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upload Insurance certificate' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload Insurance certificate' });
    const expiry = await pickExpiry(user, 'Expiry date: Insurance certificate');
    pickFile('upload-INSURANCE-0-camera', jpeg('ins.jpg'));
    await waitFor(() => expect(calls.find('PUT', '/admin/riders/r5/documents/INSURANCE/pages/0')).toHaveLength(1));
    expect((calls.find('PUT', '/admin/riders/r5/documents/INSURANCE/pages/0')[0].body as FormData).get('expiry_date')).toBe(expiry);

    // Change the expiry date alone (PATCH).
    await within(dialog).findByRole('button', { name: 'Remove page: Insurance certificate, front' });
    await user.click(within(dialog).getByRole('button', { name: /^Expiry date: Insurance certificate/ }));
    const calendar = screen.getByRole('dialog', { name: 'Expiry date: Insurance certificate calendar' });
    // The calendar opens on the saved date's month.
    await user.click(within(calendar).getAllByRole('button', { name: /^20 / })[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Save expiry date' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/riders/r5/documents/INSURANCE')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/riders/r5/documents/INSURANCE')[0].body).toEqual({ expiry_date: expiry.replace(/-15$/, '-20') });

    // Remove the page: the document is gone.
    await user.click(within(dialog).getByRole('button', { name: 'Remove page: Insurance certificate, front' }));
    await waitFor(() => expect(calls.find('DELETE', '/admin/riders/r5/documents/INSURANCE/pages/0')).toHaveLength(1));
    expect(await within(dialog).findByTestId('upload-status')).toHaveTextContent('Missing');
  });

  it('explains an upload refusal from the API', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([pending([])]));
      if (c.method === 'PUT') return fail(413, 'FILE_TOO_LARGE', 'too big');
      return undefined;
    });
    renderRequests();
    await user.click(await screen.findByRole('button', { name: 'Upload Vehicle book (CR)' }));
    pickFile('upload-VEHICLE_BOOK-0-file', jpeg());
    expect(await screen.findByText('Documents must be 8 MB or smaller.')).toBeInTheDocument();
  });

  it('replaces the page on screen from the viewer', async () => {
    const user = userEvent.setup();
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/rider-applications') return ok(page([pending([doc({ rider_id: 'r1', status: 'PENDING' })])]));
      if (c.method === 'PUT' && c.path === '/admin/riders/r1/documents/VEHICLE_BOOK/pages/0') {
        return ok({ document: doc({ rider_id: 'r1', updated_at: '2026-10-11T06:00:00.000Z' }) });
      }
      return undefined;
    });
    renderRequests();
    await user.click(await screen.findByRole('button', { name: 'Open Vehicle book (CR)' }));
    const viewer = screen.getByRole('dialog', { name: 'Vehicle book (CR) - document viewer' });
    expect(within(viewer).getByRole('button', { name: 'Remove this page' })).toBeInTheDocument();
    pickFile('viewer-page-0-file', jpeg('better.jpg'));
    await waitFor(() => expect(calls.find('PUT', '/admin/riders/r1/documents/VEHICLE_BOOK/pages/0')).toHaveLength(1));
    expect(await within(viewer).findByTestId('viewer-status')).toHaveTextContent('Verified');
  });
});
