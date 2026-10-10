import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { applicantToken } from '../api/applicant';
import { RIDER, fail, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  applicantToken.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof userEvent.setup>;

const CREATED = { status: 201, data: { application: { status: 'PENDING', full_name: 'Nimal Perera', phone: '+94771234567' } } };
/**
 * The applicant session (owner, 2026-10-10: documents). These tests cover the
 * details; with no document types asked for, "Send application" is open at
 * once. tests in rider-documents.test.tsx cover the documents step.
 */
const SESSION = {
  applicant_token: 'applicant-token',
  expires_in: 7200,
  phone: '+94771234567',
  application: null,
  document_types: [],
  documents: [],
};

/** Number -> code sent -> code checked -> the details step. */
async function toDetails(user: User, phone = '0771234567') {
  await toCode(user, phone);
  await user.type(screen.getByLabelText('6-digit code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByLabelText('Full name');
}

async function toCode(user: User, phone = '0771234567') {
  const field = await screen.findByLabelText('Mobile number');
  await user.clear(field);
  await user.type(field, phone);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('6-digit code');
}

async function fillDetails(user: User, { emergency = '' } = {}) {
  await user.type(screen.getByLabelText('Full name'), '  Nimal Perera ');
  await user.click(screen.getByRole('radio', { name: 'Three-wheeler' }));
  await user.type(screen.getByLabelText('Registration number'), ' wp abc-1234 ');
  if (emergency) await user.type(screen.getByLabelText(/Emergency contact number/), emergency);
}

/** Details -> documents -> send. */
async function send(user: User) {
  await user.click(screen.getByRole('button', { name: 'Next: your documents' }));
  await screen.findByRole('heading', { name: 'Your documents' });
  await user.click(screen.getByRole('button', { name: 'Send application' }));
}

function renderApply(handlers: Parameters<typeof renderAs>[2] = {}) {
  return renderAs(null, '/apply', {
    'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
    'POST /riders/applications/session': () => ok(SESSION),
    'GET /riders/applications/me': () => ok({ ...SESSION, applicant_token: undefined }),
    'POST /riders/applications/submit': () => CREATED,
    ...handlers,
  });
}

describe('apply to deliver', () => {
  it('the sign-in screen links to the application', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login');
    await user.type(await screen.findByLabelText('Mobile number'), '0778889990');
    await user.click(screen.getByRole('link', { name: 'Apply to deliver' }));
    expect(await screen.findByRole('heading', { name: 'Apply to deliver' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0778889990');
  });

  it('checks the number once, then sends the application exactly as the API expects', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDetails(user);
    expect(api.find('POST', '/auth/otp/request')[0].body).toEqual({ phone: '0771234567' });
    expect(api.find('POST', '/riders/applications/session')[0].body).toEqual({ phone: '0771234567', otp: '123456' });
    await fillDetails(user, { emergency: '0712223334' });
    await send(user);

    expect(await screen.findByRole('heading', { name: 'Application sent' })).toBeInTheDocument();
    expect(screen.getByText("Ops will review it; you'll get an SMS when you're approved.")).toBeInTheDocument();
    expect(api.find('POST', '/riders/applications/submit')[0].body).toEqual({
      full_name: 'Nimal Perera',
      vehicle_type: 'THREE_WHEELER',
      vehicle_registration_number: 'WP ABC-1234',
      emergency_contact_phone: '0712223334',
    });
    // No rider session is made by applying, and the applicant session ends.
    expect(tokenStore.access).toBeNull();
    expect(applicantToken.get()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to your deliveries' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0771234567');
  });

  it('leaves out the emergency contact when none is given', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDetails(user);
    await fillDetails(user);
    await send(user);
    await screen.findByRole('heading', { name: 'Application sent' });
    expect(api.find('POST', '/riders/applications/submit')[0].body).not.toHaveProperty('emergency_contact_phone');
  });

  it('a bicycle needs no registration number, and none is sent', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDetails(user);
    await user.type(screen.getByLabelText('Full name'), 'Nimal Perera');
    await user.click(screen.getByRole('radio', { name: 'Bicycle' }));
    expect(screen.getByLabelText(/Registration number \(not needed for bicycles\)/)).not.toBeRequired();
    await send(user);
    await screen.findByRole('heading', { name: 'Application sent' });
    expect(api.find('POST', '/riders/applications/submit')[0].body).toEqual({
      full_name: 'Nimal Perera',
      vehicle_type: 'BICYCLE',
    });
  });

  it('every other vehicle still needs a registration number', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDetails(user);
    await user.type(screen.getByLabelText('Full name'), 'Nimal Perera');
    await user.click(screen.getByRole('radio', { name: 'Motorcycle' }));
    expect(screen.getByLabelText('Registration number')).toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Next: your documents' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Enter your vehicle's registration number.");
    expect(screen.queryByRole('heading', { name: 'Your documents' })).toBeNull();
    expect(api.find('POST', '/riders/applications/submit')).toHaveLength(0);
  });

  it('vehicle types are big tappable choices covering every type', async () => {
    const user = userEvent.setup();
    renderApply();
    await toDetails(user);
    for (const name of ['Motorcycle', 'Scooter', 'Three-wheeler', 'Bicycle', 'Car']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('catches missing details before moving on', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toDetails(user);
    await user.type(screen.getByLabelText('Full name'), 'Nimal Perera');
    await user.click(screen.getByRole('button', { name: 'Next: your documents' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose your vehicle.');
    expect(api.find('POST', '/riders/applications/submit')).toHaveLength(0);
  });

  it('asks for the whole code before checking it', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 6-digit code from the SMS.');
    expect(api.find('POST', '/riders/applications/session')).toHaveLength(0);
  });

  it('checks the number before sending a code', async () => {
    const user = userEvent.setup();
    const { api } = renderApply();
    await user.type(await screen.findByLabelText('Mobile number'), '12345');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a Sri Lankan mobile number');
    expect(api.find('POST', '/auth/otp/request')).toHaveLength(0);
  });

  it('APPLICATION_PENDING shows the waiting screen', async () => {
    const user = userEvent.setup();
    let sent = false;
    renderApply({
      'POST /riders/applications/submit': () => {
        sent = true;
        return fail(409, 'APPLICATION_PENDING', 'Already waiting.');
      },
      'GET /riders/applications/me': () =>
        ok({
          ...SESSION,
          application: sent
            ? { id: 'r-1', status: 'PENDING', vehicle_type: 'THREE_WHEELER', vehicle_registration_number: 'WP ABC-1234', full_name: 'Nimal Perera', rejection_reason: null, applied_at: '2026-10-10T08:00:00.000Z' }
            : null,
        }),
    });
    await toDetails(user);
    await fillDetails(user);
    await send(user);
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(
      screen.getByText("Your application is waiting for approval. We'll send you an SMS when you're approved.")
    ).toBeInTheDocument();
  });

  it('a number that already applied sees its application straight away', async () => {
    const user = userEvent.setup();
    renderApply({
      'POST /riders/applications/session': () =>
        ok({
          ...SESSION,
          application: { id: 'r-1', status: 'PENDING', vehicle_type: 'BICYCLE', vehicle_registration_number: null, full_name: 'Nimal Perera', rejection_reason: null, applied_at: '2026-10-10T08:00:00.000Z' },
        }),
    });
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your documents' })).toBeInTheDocument();
  });

  it('a pending rider asking for a code goes straight to the waiting screen', async () => {
    const user = userEvent.setup();
    renderApply({
      'POST /auth/otp/request': () => fail(403, 'RIDER_PENDING_APPROVAL', 'Waiting.'),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
  });

  it('ALREADY_APPROVED goes back to sign-in with the number filled in', async () => {
    const user = userEvent.setup();
    renderApply({
      'POST /riders/applications/submit': () =>
        fail(409, 'ALREADY_APPROVED', 'This number is already an approved rider. Sign in instead.'),
    });
    await toDetails(user);
    await fillDetails(user);
    await send(user);
    expect(await screen.findByRole('heading', { name: 'Sign in to your deliveries' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0771234567');
    expect(screen.getByRole('status')).toHaveTextContent("You're already an approved rider. Sign in instead.");
  });

  it('PHONE_IN_USE explains the number belongs to another Blynk account', async () => {
    const user = userEvent.setup();
    renderApply({
      'POST /riders/applications/session': () =>
        fail(409, 'PHONE_IN_USE', 'This number is already used by another Blynk account.'),
    });
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This number is already used by another Blynk account. Apply with a different number.'
    );
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });

  it.each([
    ['INVALID_OTP', 401, { remaining_attempts: 1 }, "That code isn't right. 1 try left."],
    ['OTP_EXPIRED', 410, undefined, 'That code has expired. Ask for a new one.'],
    ['OTP_MAX_ATTEMPTS_EXCEEDED', 429, undefined, 'Too many wrong codes. Ask for a new one.'],
  ])('%s keeps the rider on the code step with a clear message', async (code, status, details, message) => {
    const user = userEvent.setup();
    renderApply({ 'POST /riders/applications/session': () => fail(status, code, code, details) });
    await toCode(user);
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('an ended applicant session goes back to the number, uploads kept', async () => {
    const user = userEvent.setup();
    renderApply({ 'POST /riders/applications/submit': () => fail(401, 'APPLICANT_SESSION_EXPIRED', 'Ended.') });
    await toDetails(user);
    await fillDetails(user);
    await send(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your uploaded documents are kept.');
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
  });

  it('a rate-limited code request says how long to wait', async () => {
    const user = userEvent.setup();
    renderApply({
      'POST /auth/otp/request': () => fail(429, 'TOO_MANY_REQUESTS', 'Slow down.', { retry_after_seconds: 50 }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many codes asked for. Try again in 1 minute.');
  });

  it('a signed-in rider is sent to their deliveries', async () => {
    renderAs(RIDER, '/apply');
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
  });
});
