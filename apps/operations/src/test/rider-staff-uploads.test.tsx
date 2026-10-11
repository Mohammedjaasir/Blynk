import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { RiderApplication, RiderDocumentRequirement, StaffRiderDocument } from '../api/types';
import { formatDay } from '../lib/riderDocuments';
import { colomboDate } from '../lib/slots';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Staff add riders and upload their documents (owner, 2026-10-11: "Mainly I
 * am going to approve the drivers manually; they will send docs on
 * WhatsApp" / "Add a delivery rider and I upload the things"): the two
 * Settings switches, Riders -> Add rider, and Upload / Replace / Remove page
 * / expiry in the documents panel. The API is tested in backend/api/tests.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:picked');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MOTOR = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'];
const DOC_TYPES = [
  { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', needs_expiry: false, needs_back: false, enabled: true },
  { key: 'REVENUE_LICENCE', label: 'Revenue licence', needs_expiry: true, needs_back: false, enabled: false },
  { key: 'INSURANCE', label: 'Insurance certificate', needs_expiry: true, needs_back: false, enabled: true },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', needs_expiry: true, needs_back: true, enabled: true },
].map((d) => ({ ...d, builtin: true, required_for: MOTOR }));

const settingsReply = (overrides: Record<string, unknown> = {}) =>
  ok({
    settings: {
      documents: DOC_TYPES,
      updated_at: null,
      applicant_uploads_enabled: false,
      require_documents_for_approval: true,
      ...overrides,
    },
  });

const image = (name = 'photo.jpg', type = 'image/jpeg') => new File(['img'], name, { type });

function pick(testId: string, file: File) {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
}

function staffDoc(overrides: Partial<StaffRiderDocument> = {}): StaffRiderDocument {
  return {
    id: 'd-new',
    rider_id: 'r9',
    doc_type: 'INSURANCE',
    label: 'Insurance certificate',
    custom: false,
    pages: [{ index: 0, content_type: 'image/jpeg', bytes: 3, uploaded_at: '2026-10-11T05:00:00.000Z' }],
    pages_needed: 1,
    expiry_date: null,
    expiry_state: null,
    status: 'PENDING',
    reject_reason: null,
    reject_reason_label: null,
    reject_note: null,
    reviewed_at: null,
    reviewed_by_name: null,
    updated_at: '2026-10-11T05:00:00.000Z',
    ...overrides,
  };
}

const createdRider = (overrides: Partial<RiderApplication> = {}): RiderApplication => ({
  id: 'r9',
  user_id: 'u9',
  full_name: 'Ruwan Jayasinghe',
  phone: '+94771239876',
  vehicle_type: 'MOTORCYCLE',
  vehicle_registration_number: 'WP BEE-4521',
  emergency_contact_phone: null,
  approval_status: 'PENDING',
  applied_at: '2026-10-11T05:00:00.000Z',
  reviewed_at: null,
  reviewed_by_name: null,
  rejection_reason: null,
  pay_type: 'COMPANY',
  commission_percent: null,
  pay_model: null,
  ...overrides,
});

/** A future date the styled calendar can pick: next year, this month, the 15th. */
async function pickExpiry(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  buttonName: RegExp,
  calendarName: string,
  /** The calendar opens on the stored date when there is one. */
  base = colomboDate(new Date())
) {
  await user.click(within(scope).getByRole('button', { name: buttonName }));
  const calendar = within(scope).getByRole('dialog', { name: calendarName });
  await user.click(within(calendar).getByRole('button', { name: 'Next year' }));
  const [y, m] = base.split('-');
  const picked = `${Number(y) + 1}-${m}-15`;
  await user.click(within(calendar).getByRole('button', { name: formatDay(picked) }));
  return picked;
}

describe('Settings -> Rider documents: the two switches (owner, 2026-10-11)', () => {
  it('shows both switches with their explanations and saves them in the PUT', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-documents', {
      'GET /admin/settings/rider-documents': () => settingsReply(),
      'PUT /admin/settings/rider-documents': (call) => settingsReply({ ...call.body, documents: DOC_TYPES }),
    });

    const uploads = await screen.findByRole('switch', { name: 'Riders upload documents in the app' });
    const needDocs = screen.getByRole('switch', { name: 'Documents needed before approval' });
    expect(uploads).toHaveAttribute('aria-checked', 'false');
    expect(needDocs).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/send their documents to Blynk on WhatsApp \+94 71 710 7374/)).toBeInTheDocument();
    expect(screen.getByText(/Documents you upload count as verified at once/)).toBeInTheDocument();

    await user.click(uploads);
    await user.click(needDocs);
    expect(uploads).toHaveAttribute('aria-checked', 'true');
    expect(needDocs).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/applicants photograph and upload each document/)).toBeInTheDocument();
    expect(screen.getByText('Off: riders can be approved without documents.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save rider documents' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-documents')).toHaveLength(1));
    const body = api.find('PUT', '/admin/settings/rider-documents')[0].body;
    expect(body.applicant_uploads_enabled).toBe(true);
    expect(body.require_documents_for_approval).toBe(false);
    expect(body.documents).toHaveLength(DOC_TYPES.length);
    expect(await screen.findByText(/Rider documents saved/)).toBeInTheDocument();
  });

  it('falls back to the API defaults when the reply has no switches', async () => {
    renderAs(OPERATIONS_STAFF, '/more/rider-documents', {
      'GET /admin/settings/rider-documents': () => ok({ settings: { documents: DOC_TYPES, updated_at: null } }),
    });
    expect(await screen.findByRole('switch', { name: 'Riders upload documents in the app' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Documents needed before approval' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Riders -> Add rider (owner, 2026-10-11)', () => {
  async function openForm(handlers: Record<string, (call: any) => unknown> = {}) {
    const user = userEvent.setup();
    const utils = renderAs(OPERATIONS_STAFF, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [] }),
      'GET /admin/rider-documents/alerts': () => ok({ warning_days: 30, alerts: [] }),
      'GET /admin/settings/rider-documents': () => settingsReply(),
      ...handlers,
    });
    await user.click(await screen.findByRole('button', { name: 'Add rider' }));
    const form = screen.getByRole('dialog', { name: 'Add rider' });
    await within(form).findByRole('group', { name: 'Insurance certificate' });
    return { user, form, ...utils };
  }

  async function fillBasics(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
    await user.type(within(form).getByLabelText('Full name'), 'Ruwan Jayasinghe');
    await user.type(within(form).getByLabelText(/^Phone/), '077 123 9876');
    await user.type(within(form).getByLabelText('Registration number'), 'WP BEE-4521');
  }

  it('validates before sending anything; a bicycle needs no registration number', async () => {
    const { user, form, api } = await openForm();
    // Only enabled document types are listed, marked Required for the vehicle.
    expect(within(form).queryByRole('group', { name: 'Revenue licence' })).toBeNull();
    expect(within(within(form).getByRole('group', { name: 'Driving licence' })).getByText('Required')).toBeInTheDocument();

    await user.type(within(form).getByLabelText(/^Phone/), '12345');
    await user.type(within(form).getByLabelText(/Emergency contact phone/), '0112');
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Check the highlighted fields.');
    expect(within(form).getByText(/Enter their full name/)).toBeInTheDocument();
    expect(within(form).getByText('Enter a Sri Lankan mobile number, e.g. 077 123 4567.')).toBeInTheDocument();
    expect(within(form).getByText('Enter the number plate.')).toBeInTheDocument();
    expect(within(form).getByText('Enter a Sri Lankan mobile number, or leave it empty.')).toBeInTheDocument();

    // A back page without its front.
    pick('add-DRIVING_LICENCE-1-file', image('back.jpg'));
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(within(form).getByText('Add the front page first.')).toBeInTheDocument();

    // Bicycle: no registration field, and nothing is required for it.
    await user.click(within(form).getByRole('button', { name: 'Bicycle' }));
    expect(within(form).queryByLabelText('Registration number')).toBeNull();
    expect(within(within(form).getByRole('group', { name: 'Driving licence' })).queryByText('Required')).toBeNull();
    expect(api.find('POST', '/admin/riders')).toHaveLength(0);
  });

  it('refuses HEIC and files over 8 MB with a friendly message', async () => {
    const { form } = await openForm();
    pick('add-INSURANCE-0-file', image('IMG_1.HEIC', 'image/heic'));
    expect(await within(form).findByText(/HEIC photos cannot be used/)).toBeInTheDocument();
    const big = image('big.jpg');
    Object.defineProperty(big, 'size', { value: 8 * 1024 * 1024 + 1 });
    pick('add-INSURANCE-0-camera', big);
    expect(await within(form).findByText('This file is larger than 8 MB. Take the photo again or choose a smaller file.')).toBeInTheDocument();
    expect(within(form).queryByText('big.jpg')).toBeNull();
  });

  it('creates the rider with the pay fields, uploads each page (front first, expiry with it) and approves', async () => {
    const order: string[] = [];
    let approved = false;
    const { user, form, api } = await openForm({
      'POST /admin/riders': () => {
        order.push('create');
        return { status: 201, data: { rider: createdRider(), approved: false, documents_blocking: [], from: 'NEW_NUMBER' } };
      },
      'PUT /admin/riders/:id/documents/:type/pages/:page': (call) => {
        order.push(call.path);
        return ok({ document: staffDoc({ status: 'VERIFIED' }) });
      },
      'POST /admin/rider-applications/:id/approve': () => {
        order.push('approve');
        approved = true;
        return ok({ application: createdRider({ approval_status: 'APPROVED' }) });
      },
      'GET /admin/riders': () =>
        ok({
          riders: approved
            ? [{ id: 'r9', full_name: 'Ruwan Jayasinghe', phone: '+94771239876', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP BEE-4521', open_deliveries: 0 }]
            : [],
        }),
    });
    await fillBasics(user, form);
    await user.type(within(form).getByLabelText(/Emergency contact phone/), '0712345678');

    // Commission, fixed LKR per delivery (the approve body's pay fields).
    await user.click(within(form).getByRole('button', { name: 'Commission' }));
    await user.click(within(form).getByRole('button', { name: 'Fixed' }));
    const fixed = within(form).getByLabelText('LKR per delivery');
    await user.clear(fixed);
    await user.type(fixed, '120');

    // Insurance: one page + expiry; driving licence: front and back + expiry.
    const insurance = within(form).getByRole('group', { name: 'Insurance certificate' });
    pick('add-INSURANCE-0-file', image('insurance.pdf', 'application/pdf'));
    expect(await within(insurance).findByText('insurance.pdf')).toBeInTheDocument();
    const insuranceExpiry = await pickExpiry(user, insurance, /Expiry date: Insurance certificate/, 'Pick expiry date: insurance certificate');
    const licence = within(form).getByRole('group', { name: 'Driving licence' });
    pick('add-DRIVING_LICENCE-0-camera', image('front.jpg'));
    pick('add-DRIVING_LICENCE-1-file', image('back.png', 'image/png'));
    expect(await within(licence).findByText('back.png')).toBeInTheDocument();
    const licenceExpiry = await pickExpiry(user, licence, /Expiry date: Driving licence/, 'Pick expiry date: driving licence');

    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(await screen.findByText('Rider added. They can sign in to the Blynk Rider app with 077 123 9876 now.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add rider' })).toBeNull();

    expect(api.find('POST', '/admin/riders')[0].body).toEqual({
      full_name: 'Ruwan Jayasinghe',
      phone: '077 123 9876',
      vehicle_type: 'MOTORCYCLE',
      vehicle_registration_number: 'WP BEE-4521',
      emergency_contact_phone: '0712345678',
      pay_type: 'COMMISSION',
      pay_model: 'FIXED',
      fixed_lkr: 120,
      min_lkr: null,
    });
    expect(order).toEqual([
      'create',
      '/admin/riders/r9/documents/INSURANCE/pages/0',
      '/admin/riders/r9/documents/DRIVING_LICENCE/pages/0',
      '/admin/riders/r9/documents/DRIVING_LICENCE/pages/1',
      'approve',
    ]);
    const uploads = api.calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/admin/riders/'));
    expect(uploads[0].body.expiry_date).toBe(insuranceExpiry);
    expect((uploads[0].body.file as File).name).toBe('insurance.pdf');
    expect(uploads[1].body.expiry_date).toBe(licenceExpiry);
    expect((uploads[1].body.file as File).name).toBe('front.jpg');
    expect(uploads[2].body.expiry_date).toBeUndefined();
    expect((uploads[2].body.file as File).name).toBe('back.png');
    // Approve keeps the pay stored at creation: the body is {}.
    expect(api.find('POST', '/admin/rider-applications/r9/approve')[0].body).toEqual({});
    // The list is read again and shows the new rider.
    expect(await screen.findByText('Ruwan Jayasinghe')).toBeInTheDocument();
  });

  it('does not call approve when the server approved at once (bicycle, no registration sent)', async () => {
    const { user, form, api } = await openForm({
      'POST /admin/riders': () => ({
        status: 201,
        data: { rider: createdRider({ approval_status: 'APPROVED', vehicle_type: 'BICYCLE' }), approved: true, documents_blocking: [], from: 'CUSTOMER' },
      }),
    });
    await user.type(within(form).getByLabelText('Full name'), 'Ruwan Jayasinghe');
    await user.type(within(form).getByLabelText(/^Phone/), '+94771239876');
    await user.click(within(form).getByRole('button', { name: 'Bicycle' }));
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(await screen.findByText(/Rider added\. They can sign in .* 077 123 9876 now\. Their Blynk customer account stays the same\./)).toBeInTheDocument();
    expect(api.find('POST', '/admin/riders')[0].body).toEqual({
      full_name: 'Ruwan Jayasinghe',
      phone: '+94771239876',
      vehicle_type: 'BICYCLE',
      emergency_contact_phone: null,
      pay_type: 'COMPANY',
    });
    expect(api.calls.filter((c) => c.path.endsWith('/approve'))).toHaveLength(0);
  });

  it('keeps the rider when approval is refused for documents, and names a failed upload', async () => {
    const { user, form } = await openForm({
      'POST /admin/riders': () => ({
        status: 201,
        data: {
          rider: createdRider(),
          approved: false,
          documents_blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'MISSING', expiry_state: null }],
          from: 'APPLICATION',
        },
      }),
      'PUT /admin/riders/:id/documents/:type/pages/:page': () => ({
        status: 413,
        error: { code: 'FILE_TOO_LARGE', message: 'too large' },
      }),
      'POST /admin/rider-applications/:id/approve': () => ({
        status: 409,
        error: {
          code: 'DOCUMENTS_NOT_VERIFIED',
          message: 'no',
          details: { blocking: [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'MISSING', expiry_state: null }] },
        },
      }),
    });
    await fillBasics(user, form);
    pick('add-INSURANCE-0-file', image('insurance.jpg'));
    await within(form).findByText('insurance.jpg');
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));

    const notice = await screen.findByText(/Ruwan Jayasinghe was saved and waits under Rider requests for these documents: Insurance certificate \(missing\)\./);
    expect(notice).toHaveTextContent(/These documents did not upload: Insurance certificate front \(This file is larger than 8 MB/);
    expect(notice).toHaveTextContent(/Upload them again from Documents under Rider requests\./);
    expect(screen.getByRole('link', { name: 'Open Rider requests' })).toHaveAttribute('href', '/more/rider-requests');
  });

  it.each([
    ['STAFF_CAN_DELIVER', /Operations staff account\. To let them deliver, turn on "Can deliver"/],
    ['PHONE_IN_USE', /belongs to a staff or admin account/],
    ['ALREADY_APPROVED', /This number is already a rider\./],
    ['ACCOUNT_DISABLED', /disabled, so it cannot be added/],
  ])('explains a %s refusal and keeps the form open', async (code, text) => {
    const { user, form, api } = await openForm({ 'POST /admin/riders': () => fail(409, code) });
    await fillBasics(user, form);
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('dialog', { name: 'Add rider' })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('puts a server validation message on its field', async () => {
    const { user, form } = await openForm({
      'POST /admin/riders': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ field: 'vehicle_registration_number', message: 'Use letters and numbers only.' }] },
      }),
    });
    await fillBasics(user, form);
    await user.click(within(form).getByRole('button', { name: 'Add rider' }));
    expect(await within(form).findByText('Use letters and numbers only.')).toBeInTheDocument();
  });
});

describe('Documents panel - staff upload (owner, 2026-10-11)', () => {
  function requirement(overrides: Partial<RiderDocumentRequirement>): RiderDocumentRequirement {
    return {
      key: 'INSURANCE',
      label: 'Insurance certificate',
      required: true,
      needs_expiry: true,
      needs_back: false,
      document_id: null,
      status: 'MISSING',
      expiry_state: null,
      ...overrides,
    };
  }

  function pendingApplicant(documents: StaffRiderDocument[], overrides: Partial<RiderApplication> = {}): RiderApplication {
    return {
      ...createdRider(),
      documents,
      document_requirements: [
        requirement({ document_id: documents[0]?.id ?? null, status: documents[0]?.status ?? 'MISSING' }),
        requirement({ key: 'DRIVING_LICENCE', label: 'Driving licence', needs_back: true }),
      ],
      documents_blocking: documents[0]?.status === 'VERIFIED' ? [] : [{ key: 'INSURANCE', label: 'Insurance certificate', status: 'MISSING', expiry_state: null }],
      documents_verified: documents[0]?.status === 'VERIFIED',
      approval_needs_documents: true,
      ...overrides,
    };
  }

  const page = (applications: RiderApplication[]) => ({
    applications,
    pagination: { page: 1, limit: 50, total: applications.length, total_pages: 1 },
  });

  it('uploads a missing document for a pending applicant with its expiry date; the row refreshes', async () => {
    const user = userEvent.setup();
    let uploaded: StaffRiderDocument | null = null;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([pendingApplicant(uploaded ? [uploaded] : [])])),
      'PUT /admin/riders/:id/documents/:type/pages/:page': (call) => {
        uploaded = staffDoc({ status: 'VERIFIED', expiry_date: call.body.expiry_date, expiry_state: 'OK' });
        return ok({ document: uploaded });
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Upload Insurance certificate' }));
    const sheet = screen.getByRole('dialog', { name: 'Upload Insurance certificate' });
    const picked = await pickExpiry(user, sheet, /Expiry date/, 'Pick expiry date');
    pick('upload-INSURANCE-0-file', image('ins.jpg'));

    expect(await within(sheet).findByText('Insurance certificate: front page uploaded. Insurance certificate is verified.')).toBeInTheDocument();
    const call = api.find('PUT', '/admin/riders/r9/documents/INSURANCE/pages/0')[0];
    expect(call.body.expiry_date).toBe(picked);
    expect((call.body.file as File).name).toBe('ins.jpg');
    await waitFor(() => expect(api.find('GET', '/admin/rider-applications').length).toBeGreaterThanOrEqual(2));

    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    // The tile now offers Replace, and Approve is open.
    expect(await screen.findByRole('button', { name: 'Replace Insurance certificate' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('the back page waits for the front; Remove page and the expiry date call their endpoints', async () => {
    const user = userEvent.setup();
    const existing = staffDoc({ status: 'VERIFIED', expiry_date: '2027-05-01', expiry_state: 'OK' });
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () => ok(page([pendingApplicant([existing])])),
      'DELETE /admin/riders/:id/documents/:type/pages/:page': () => ok({ document: null }),
      'PATCH /admin/riders/:id/documents/:type': (call) => ok({ document: { ...existing, expiry_date: call.body.expiry_date } }),
    });

    // Driving licence: nothing uploaded, so the back buttons are locked.
    await user.click(await screen.findByRole('button', { name: 'Upload Driving licence' }));
    let sheet = screen.getByRole('dialog', { name: 'Upload Driving licence' });
    expect(within(sheet).getByRole('button', { name: 'Choose file for Driving licence back' })).toBeDisabled();
    expect(within(sheet).getByText('Upload the front first.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Close upload' }));

    // Insurance: change the expiry date, then remove the page.
    await user.click(screen.getByRole('button', { name: 'Replace Insurance certificate' }));
    sheet = screen.getByRole('dialog', { name: 'Upload Insurance certificate' });
    const picked = await pickExpiry(user, sheet, /Expiry date/, 'Pick expiry date', '2027-05-01');
    await user.click(within(sheet).getByRole('button', { name: 'Save expiry date' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r9/documents/INSURANCE')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/riders/r9/documents/INSURANCE')[0].body).toEqual({ expiry_date: picked });
    expect(await within(sheet).findByText(/expiry date saved/)).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Remove Insurance certificate front page' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Remove the front page?' })).getByRole('button', { name: 'Remove page' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/riders/r9/documents/INSURANCE/pages/0')).toHaveLength(1));
    expect(await within(sheet).findByText(/front page removed\. Insurance certificate has no pages now\./)).toBeInTheDocument();
  });

  it('shows an upload refusal, and says when documents are not needed for approval', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () =>
        ok(page([pendingApplicant([], { approval_needs_documents: false, documents_blocking: [], documents_verified: true })])),
      'PUT /admin/riders/:id/documents/:type/pages/:page': () => ({
        status: 415,
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'no' },
      }),
    });
    expect(await screen.findByText('Documents not needed for approval.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Upload Insurance certificate' }));
    const sheet = screen.getByRole('dialog', { name: 'Upload Insurance certificate' });
    pick('upload-INSURANCE-0-camera', image('x.webp', 'image/webp'));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Use a JPEG, PNG or WebP photo, or a PDF.');
  });

  it('works from the Riders list documents sheet for an approved rider', async () => {
    const user = userEvent.setup();
    let docs: StaffRiderDocument[] = [];
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () =>
        ok({ riders: [{ id: 'r9', full_name: 'Ruwan Jayasinghe', phone: '+94771239876', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP BEE-4521', open_deliveries: 0 }] }),
      'GET /admin/rider-documents/alerts': () => ok({ warning_days: 30, alerts: [] }),
      'GET /admin/riders/:id/documents': () =>
        ok({
          rider: { id: 'r9', full_name: 'Ruwan Jayasinghe', vehicle_type: 'MOTORCYCLE', approval_status: 'APPROVED' },
          documents: docs,
          requirements: [requirement({ needs_expiry: false, document_id: docs[0]?.id ?? null })],
          blocking: [],
          all_required_verified: true,
          approval_needs_documents: false,
        }),
      'PUT /admin/riders/:id/documents/:type/pages/:page': () => {
        docs = [staffDoc({ status: 'VERIFIED' })];
        return ok({ document: docs[0] });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Documents for Ruwan Jayasinghe' }));
    const panel = screen.getByRole('dialog', { name: 'Documents of Ruwan Jayasinghe' });
    expect(await within(panel).findByText(/Documents not needed for approval/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Upload Insurance certificate' }));
    pick('upload-INSURANCE-0-file', image('ins.png', 'image/png'));
    await waitFor(() => expect(api.find('PUT', '/admin/riders/r9/documents/INSURANCE/pages/0')).toHaveLength(1));
    expect(api.find('PUT', '/admin/riders/r9/documents/INSURANCE/pages/0')[0].body.expiry_date).toBeUndefined();
    await waitFor(() => expect(api.find('GET', '/admin/riders/r9/documents').length).toBeGreaterThanOrEqual(2));
    expect(await within(panel).findByRole('button', { name: 'Replace Insurance certificate' })).toBeInTheDocument();
  });
});
