import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { applicantToken, type RiderDocument } from '../api/applicant';
import { fail, ok, renderAs } from './helpers';

/**
 * Rider documents in the Rider app (owner, 2026-10-10): the documents step of
 * the application (camera / gallery, progress, retake / remove, expiry date,
 * "Send application" only when the required ones are there), a rejected
 * document's reason and re-upload, and "See my documents" from sign-in.
 */

const MOTOR = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'];
const TYPES = [
  { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', builtin: true, required_for: MOTOR, needs_expiry: false, needs_back: false },
  { key: 'REVENUE_LICENCE', label: 'Revenue licence', builtin: true, required_for: MOTOR, needs_expiry: true, needs_back: false },
  { key: 'INSURANCE', label: 'Insurance certificate', builtin: true, required_for: MOTOR, needs_expiry: true, needs_back: false },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', builtin: true, required_for: MOTOR, needs_expiry: true, needs_back: true },
];
const SESSION = { applicant_token: 'applicant-token', expires_in: 7200, phone: '+94771234567', application: null, document_types: TYPES, documents: [] };

function doc(type: string, pages: number, extra: Partial<RiderDocument> = {}): RiderDocument {
  const t = TYPES.find((x) => x.key === type)!;
  return {
    id: `doc-${type}`,
    doc_type: type,
    label: t.label,
    custom: false,
    pages: Array.from({ length: pages }, (_, index) => ({ index, content_type: 'image/jpeg', bytes: 1000, uploaded_at: `2026-10-10T08:00:0${index}.000Z` })),
    pages_needed: t.needs_back ? 2 : 1,
    expiry_date: null,
    expiry_state: null,
    status: 'PENDING',
    reject_reason: null,
    reject_reason_label: null,
    reject_note: null,
    reviewed_at: null,
    updated_at: '2026-10-10T08:00:00.000Z',
    ...extra,
  };
}

/** XMLHttpRequest stand-in for page uploads: records each, answers via `reply`. */
interface Upload {
  method: string;
  url: string;
  headers: Record<string, string>;
  form: FormData;
}
const uploads: Upload[] = [];
/** While set, uploads wait for it (to see the progress bar). */
let gate: Promise<void> | null = null;
let reply: (u: Upload) => { status: number; data?: unknown; error?: unknown } = () => ({ status: 500, error: { code: 'NOPE', message: 'no reply set' } });
class FakeXHR {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(form: FormData) {
    const u: Upload = { method: this.method, url: new URL(this.url).pathname.replace(/^\/api\/v1/, ''), headers: this.headers, form };
    uploads.push(u);
    setTimeout(async () => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 });
      if (gate) await gate;
      const r = reply(u);
      this.status = r.status;
      this.responseText = JSON.stringify(r.status < 400 ? { success: true, data: r.data } : { success: false, error: r.error });
      this.onload?.();
    }, 0);
  }
}

const jpeg = (name = 'photo.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], name, { type: 'image/jpeg' });

beforeEach(() => {
  uploads.length = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  tokenStore.clear();
  applicantToken.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof userEvent.setup>;

async function toDocuments(user: User, vehicle = 'Motorcycle') {
  await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await user.type(await screen.findByLabelText('6-digit code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Full name'), 'Nimal Perera');
  await user.click(screen.getByRole('radio', { name: vehicle }));
  if (vehicle !== 'Bicycle') await user.type(screen.getByLabelText('Registration number'), 'WP BCD-1234');
  await user.click(screen.getByRole('button', { name: 'Next: your documents' }));
  await screen.findByRole('heading', { name: 'Your documents' });
}

const card = (label: string) => screen.getByRole('region', { name: label });
const formObject = (form: FormData) => Object.fromEntries([...form.entries()].map(([k, v]) => [k, v instanceof Blob ? 'FILE' : v]));

function renderApply(handlers: Parameters<typeof renderAs>[2] = {}) {
  return renderAs(null, '/apply', {
    'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
    'POST /riders/applications/session': () => ok(SESSION),
    'GET /riders/applications/me': () => ok({ ...SESSION, applicant_token: undefined }),
    'POST /riders/applications/submit': () => ({ status: 201, data: { application: { status: 'PENDING' } } }),
    ...handlers,
  });
}

describe('rider documents - applying', () => {
  it('lists every document for a motorcycle as required; Send waits for all of them', async () => {
    const user = userEvent.setup();
    renderApply();
    await toDocuments(user);
    for (const t of TYPES) expect(within(card(t.label)).getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send application' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Still needed: Vehicle book (CR), Revenue licence, Insurance certificate, Driving licence');
    // Each empty page offers the camera (rear camera) and the gallery (photos or PDF).
    const camera = within(card('Vehicle book (CR)')).getByLabelText('Take a photo: Front');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(within(card('Vehicle book (CR)')).getByLabelText('Choose from gallery: Front')).toHaveAttribute('accept', 'image/*,application/pdf');
    // The driving licence asks for the back too, after the front.
    expect(within(card('Driving licence')).getByText('Back')).toBeInTheDocument();
    expect(within(card('Driving licence')).getByText('Add the front first.')).toBeInTheDocument();
  });

  it('a bicycle sees the documents as optional and can send without them', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDocuments(user, 'Bicycle');
    expect(within(card('Vehicle book (CR)')).getByText('Optional')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('heading', { name: 'Application sent' })).toBeInTheDocument();
    expect(api.find('POST', '/riders/applications/submit')).toHaveLength(1);
  });

  it('uploads a page at once with the applicant token, shows progress, and the expiry picked first', async () => {
    const user = userEvent.setup();
    reply = () => ({ status: 200, data: { document: doc('INSURANCE', 1, { expiry_date: '2027-03-15', expiry_state: 'OK' }) } });
    renderApply();
    await toDocuments(user);

    // The app's own date picker (not a native control): pick 15 March next year.
    const insurance = card('Insurance certificate');
    await user.click(within(insurance).getByRole('button', { name: /Expiry date: Add the expiry date/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Expiry date' });
    // Step to March 2027 whatever today is.
    for (let i = 0; i < 40; i++) {
      if (within(sheet).queryByText('March 2027')) break;
      const now = within(sheet).getByText(/\d{4}$/).textContent!;
      await user.click(within(sheet).getByRole('button', { name: new Date(now) < new Date('March 1, 2027') ? 'Next month' : 'Previous month' }));
    }
    await user.click(within(sheet).getByRole('button', { name: '15 Mar 2027' }));
    await user.click(within(sheet).getByRole('button', { name: 'Use 15 Mar 2027' }));
    expect(within(insurance).getByRole('button', { name: 'Expiry date: 15 Mar 2027' })).toBeInTheDocument();

    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => (release = resolve));
    fireEvent.change(within(insurance).getByLabelText('Choose from gallery: Front'), { target: { files: [jpeg()] } });
    expect(await within(insurance).findByRole('progressbar')).toBeInTheDocument();
    expect(await within(insurance).findByText('Uploading 40%')).toBeInTheDocument();
    release();
    gate = null;
    expect(await within(insurance).findByText('Uploaded')).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ method: 'PUT', url: '/riders/applications/documents/INSURANCE/pages/0' });
    expect(uploads[0].headers.Authorization).toBe('Bearer applicant-token');
    expect(formObject(uploads[0].form)).toEqual({ expiry_date: '2027-03-15', file: 'FILE' });
    // Retake / gallery / remove once uploaded.
    expect(within(insurance).getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(within(insurance).getByRole('button', { name: 'Remove Front' })).toBeInTheDocument();
  });

  it('changing the expiry of an uploaded document saves it; removing a page tells the API', async () => {
    const user = userEvent.setup();
    reply = () => ({ status: 200, data: { document: doc('REVENUE_LICENCE', 1) } });
    const { api } = renderApply({
      'PATCH /riders/applications/documents/REVENUE_LICENCE': (call) =>
        ok({ document: doc('REVENUE_LICENCE', 1, { expiry_date: call.body.expiry_date }) }),
      'DELETE /riders/applications/documents/REVENUE_LICENCE/pages/0': () => ok({ document: null }),
    });
    await toDocuments(user);
    const revenue = card('Revenue licence');
    fireEvent.change(within(revenue).getByLabelText('Take a photo: Front'), { target: { files: [jpeg()] } });
    await within(revenue).findByText('Uploaded');
    await user.click(within(revenue).getByRole('button', { name: /Expiry date: Add the expiry date/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Expiry date' });
    const firstDay = within(sheet).getAllByRole('button', { pressed: false }).find((b) => b.className.includes('calendar__day'))!;
    await user.click(firstDay);
    await user.click(within(sheet).getByRole('button', { name: /^Use / }));
    expect(api.find('PATCH', '/riders/applications/documents/REVENUE_LICENCE')).toHaveLength(1);
    expect(api.find('PATCH', '/riders/applications/documents/REVENUE_LICENCE')[0].body.expiry_date).toMatch(/^\d{4}-\d{2}-01$/);

    await user.click(within(revenue).getByRole('button', { name: 'Remove Front' }));
    expect(await within(revenue).findByText('Required')).toBeInTheDocument();
    expect(api.find('DELETE', '/riders/applications/documents/REVENUE_LICENCE/pages/0')).toHaveLength(1);
  });

  it('Send opens once every required document is uploaded (front and back for the licence)', async () => {
    const user = userEvent.setup();
    reply = (u) => {
      const [, type, page] = /documents\/([A-Z_]+)\/pages\/(\d)/.exec(u.url)!;
      return { status: 200, data: { document: doc(type, Number(page) + 1) } };
    };
    const { api } = renderApply();
    await toDocuments(user);
    for (const t of TYPES) {
      fireEvent.change(within(card(t.label)).getByLabelText('Choose from gallery: Front'), { target: { files: [jpeg()] } });
      await within(card(t.label)).findByRole('button', { name: 'Remove Front' });
    }
    expect(screen.getByRole('button', { name: 'Send application' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Still needed: Driving licence');
    fireEvent.change(within(card('Driving licence')).getByLabelText('Take a photo: Back'), { target: { files: [jpeg()] } });
    await within(card('Driving licence')).findByRole('button', { name: 'Remove Back' });
    const send = screen.getByRole('button', { name: 'Send application' });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(await screen.findByRole('heading', { name: 'Application sent' })).toBeInTheDocument();
    expect(api.find('POST', '/riders/applications/submit')[0].body).toEqual({
      full_name: 'Nimal Perera',
      vehicle_type: 'MOTORCYCLE',
      vehicle_registration_number: 'WP BCD-1234',
    });
  });

  it('refuses a HEIC photo it cannot read, and shows an upload refusal', async () => {
    const user = userEvent.setup();
    reply = () => ({ status: 413, error: { code: 'FILE_TOO_LARGE', message: 'Documents must be 8 MB or smaller.' } });
    renderApply();
    await toDocuments(user);
    const book = card('Vehicle book (CR)');
    fireEvent.change(within(book).getByLabelText('Choose from gallery: Front'), {
      target: { files: [new File([new Uint8Array([0, 0, 0, 24])], 'IMG_0001.HEIC', { type: 'image/heic' })] },
    });
    expect(await within(book).findByRole('alert')).toHaveTextContent('HEIC');
    expect(uploads).toHaveLength(0);
    fireEvent.change(within(book).getByLabelText('Choose from gallery: Front'), { target: { files: [jpeg()] } });
    expect(await within(book).findByText('That file is larger than 8 MB. Take the photo again.')).toBeInTheDocument();
  });
});

describe('rider documents - after applying', () => {
  const REJECTED_APP = {
    id: 'r-1',
    status: 'PENDING',
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: 'WP BCD-1234',
    full_name: 'Nimal Perera',
    rejection_reason: null,
    applied_at: '2026-10-10T08:00:00.000Z',
  };

  it('shows which document Ops rejected and why; re-uploading puts it back for review', async () => {
    const user = userEvent.setup();
    const documents = [
      doc('VEHICLE_BOOK', 1, { status: 'VERIFIED' }),
      doc('REVENUE_LICENCE', 1, { status: 'VERIFIED' }),
      doc('INSURANCE', 1, { status: 'VERIFIED' }),
      doc('DRIVING_LICENCE', 2, {
        status: 'REJECTED',
        reject_reason: 'BLURRY',
        reject_reason_label: 'The photo is blurry or hard to read',
        reject_note: 'Front is out of focus',
      }),
    ];
    reply = () => ({ status: 200, data: { document: doc('DRIVING_LICENCE', 2) } });
    renderApply({ 'POST /riders/applications/session': () => ok({ ...SESSION, application: REJECTED_APP, documents }) });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(screen.getByText(/Ops couldn't accept Driving licence/)).toBeInTheDocument();
    const dl = card('Driving licence');
    expect(within(dl).getByText('Not accepted')).toBeInTheDocument();
    expect(within(dl).getByRole('alert')).toHaveTextContent('The photo is blurry or hard to read');
    expect(within(dl).getByRole('alert')).toHaveTextContent('Front is out of focus');
    expect(within(card('Insurance certificate')).getByText('Verified')).toBeInTheDocument();

    fireEvent.change(within(dl).getByLabelText('Take a photo: Front'), { target: { files: [jpeg()] } });
    expect(await within(dl).findByText('Waiting for review')).toBeInTheDocument();
    expect(uploads[0].url).toBe('/riders/applications/documents/DRIVING_LICENCE/pages/0');
    expect(within(dl).queryByText('Not accepted')).toBeNull();
  });

  it('from sign-in, a waiting applicant opens their documents with the same code', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '654321' }),
      'POST /auth/otp/verify': () => fail(403, 'RIDER_PENDING_APPROVAL', 'Waiting.'),
      'POST /riders/applications/session': () => ok({ ...SESSION, application: REJECTED_APP, documents: [doc('VEHICLE_BOOK', 1)] }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await user.click(await screen.findByRole('button', { name: 'See my documents' }));
    expect(await screen.findByRole('heading', { name: 'Your documents' })).toBeInTheDocument();
    expect(api.find('POST', '/riders/applications/session')[0].body).toEqual({ phone: '0771234567', otp: '654321' });
    expect(within(card('Vehicle book (CR)')).getByText('Waiting for review')).toBeInTheDocument();
  });
});
