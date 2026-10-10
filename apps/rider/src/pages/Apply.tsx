import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  applicantApi,
  applicantToken,
  documentComplete,
  documentsForVehicle,
  type ApplicantState,
  type ApplicationDetails,
  type RiderDocument,
} from '../api/applicant';
import type { VehicleType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CodeField, PendingNotice, RejectedNotice } from '../components/ApplicationNotice';
import { DocumentCard } from '../components/DocumentCard';
import { MESSAGES, errorCode, errorMessage } from '../lib/errors';
import {
  CODE_SPENT,
  OTP_LENGTH,
  PHONE_FORMAT_MESSAGE,
  isSriLankanMobile,
  rejectionReason,
  useResendTimer,
} from '../lib/otp';
import type { LoginState } from './Login';
import blynkLogo from '../assets/blynk-logo-light.png';

const VEHICLES: { value: VehicleType; label: string }[] = [
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'SCOOTER', label: 'Scooter' },
  { value: 'THREE_WHEELER', label: 'Three-wheeler' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'CAR', label: 'Car' },
];

/** What /apply can be opened with: from sign-in, a refused code to check the application with. */
export interface ApplyState {
  phone?: string;
  otp?: string;
  resume?: boolean;
}

/** The form survives the camera hand-off (Android may reload the app). */
const DRAFT_KEY = 'blynk.rider.applyDraft';
interface Draft {
  phone: string;
  fullName: string;
  vehicle: VehicleType | null;
  registration: string;
  emergency: string;
}
function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignored */
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignored */
  }
}

type Step = 'phone' | 'code' | 'details' | 'documents' | 'status' | 'sent' | 'pending';

/**
 * Apply to deliver (owner, 2026-10-07): riders apply here, Ops or Admin
 * approve, then the rider signs in with their phone and an SMS code.
 *
 * With documents (owner, 2026-10-10):
 * 1. phone -> SMS code -> "Continue" proves the number once
 *    (POST /riders/applications/session, an applicant session - not a
 *    sign-in);
 * 2. name + vehicle + registration (+ emergency contact);
 * 3. documents: a card per document (Vehicle book, Revenue licence,
 *    Insurance, Driving licence, plus any Ops added) - which are required
 *    depends on the vehicle (Ops/Admin decide). "Send application" only
 *    once every required one is uploaded (POST /riders/applications/submit);
 * 4. "Application sent". A number that already applied sees its
 *    application instead: waiting / not approved / approved, each document's
 *    review, and re-uploads just a rejected document.
 */
export function Apply() {
  const { status, requestOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const opened = (location.state as ApplyState | null) ?? {};
  const ids = { phone: useId(), otp: useId(), name: useId(), reg: useId(), emergency: useId() };

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(opened.phone ?? '');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [vehicle, setVehicle] = useState<VehicleType | null>(null);
  const [registration, setRegistration] = useState('');
  const [emergency, setEmergency] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ApplicantState | null>(null);
  const resend = useResendTimer();
  const started = useRef(false);

  // Opened from sign-in with a code that was refused (waiting / not
  // approved): that code still proves the number. Or back after a reload
  // with a live applicant session.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (opened.resume && opened.phone && opened.otp) {
      void openSession(opened.phone, opened.otp);
      return;
    }
    if (applicantToken.get()) {
      setBusy(true);
      applicantApi
        .state()
        .then((s) => {
          const draft = readDraft();
          if (draft) {
            setPhone(draft.phone);
            setFullName(draft.fullName);
            setVehicle(draft.vehicle);
            setRegistration(draft.registration);
            setEmergency(draft.emergency);
          }
          landOn(s, draft?.vehicle ? 'documents' : 'details');
        })
        .catch(() => applicantToken.clear())
        .finally(() => setBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A saved session (even one that can't be checked offline) belongs on the queue.
  if (status === 'authenticated' || status === 'offline') return <Navigate to="/" replace />;

  const toSignIn = (loginState: LoginState = {}) => {
    applicantToken.clear();
    clearDraft();
    navigate('/login', { state: { phone: phone.trim(), ...loginState } });
  };

  /** Where a session lands: the application if there is one, else the form. */
  function landOn(s: ApplicantState, otherwise: Step) {
    setState(s);
    if (s.application) {
      const a = s.application;
      if (a.full_name) setFullName((v) => v || a.full_name || '');
      setVehicle((v) => v ?? a.vehicle_type);
      if (a.vehicle_registration_number) setRegistration((v) => v || a.vehicle_registration_number || '');
      setStep('status');
    } else {
      setStep(otherwise);
    }
  }

  /** Shared by the first send and "Resend code". */
  function sendError(err: unknown) {
    const code = errorCode(err);
    if (code === 'RIDER_PENDING_APPROVAL') {
      setStep('pending');
      return;
    }
    if (code === 'RIDER_APPLICATION_REJECTED') {
      const reason = rejectionReason(err);
      setError(`${MESSAGES.RIDER_APPLICATION_REJECTED}${reason ? ` Reason: ${reason}` : ''}`);
      return;
    }
    setError(errorMessage(err, 'Could not send the code.'));
  }

  async function sendCode() {
    const { devOtp: code } = await requestOtp(phone.trim());
    setDevOtp(code ?? null);
    resend.start();
  }

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!isSriLankanMobile(phone)) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      await sendCode();
      setStep('code');
    } catch (err) {
      sendError(err);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError(null);
    setResending(true);
    try {
      await sendCode();
      setOtp('');
    } catch (err) {
      sendError(err);
    } finally {
      setResending(false);
    }
  }

  async function openSession(number: string, code: string) {
    setError(null);
    setBusy(true);
    try {
      const s = await applicantApi.startSession(number.trim(), code);
      setPhone(number);
      landOn(s, 'details');
    } catch (err) {
      if (CODE_SPENT.has(errorCode(err) ?? '')) {
        setOtp('');
        resend.clear();
      }
      setError(errorMessage(err, 'Could not check the code.'));
      // From sign-in with a code that no longer works: start from the number.
      setStep((current) => (current === 'phone' || current === 'code' ? current : 'phone'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (otp.length !== OTP_LENGTH) {
      setError('Enter the 6-digit code from the SMS.');
      return;
    }
    await openSession(phone, otp);
  }

  /** The rider's own mistakes, caught before anything is sent. */
  function checkDetails(): string | null {
    const name = fullName.trim();
    if (name.length < 2 || name.length > 128) return 'Enter your full name (2 to 128 letters).';
    if (!vehicle) return 'Choose your vehicle.';
    if (!registration.trim() && vehicle !== 'BICYCLE') return "Enter your vehicle's registration number.";
    if (emergency.trim() && !isSriLankanMobile(emergency)) {
      return 'Enter the emergency contact as a Sri Lankan mobile number, like 077 123 4567.';
    }
    return null;
  }

  function submitDetails(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = checkDetails();
    if (problem) {
      setError(problem);
      return;
    }
    saveDraft({ phone, fullName, vehicle, registration, emergency });
    setStep('documents');
  }

  function details(): ApplicationDetails {
    const input: ApplicationDetails = { full_name: fullName.trim(), vehicle_type: vehicle as VehicleType };
    // Bicycles have no registration: left out when empty (required for every other type).
    if (registration.trim()) input.vehicle_registration_number = registration.trim().toUpperCase();
    if (emergency.trim()) input.emergency_contact_phone = emergency.trim();
    return input;
  }

  /** The session ended (2 hours): check the number again; the uploads are kept on the server. */
  function sessionEnded() {
    applicantToken.clear();
    setOtp('');
    setDevOtp(null);
    resend.clear();
    setStep('phone');
    setError(MESSAGES.APPLICANT_SESSION_EXPIRED);
  }

  async function sendApplication() {
    setError(null);
    setBusy(true);
    try {
      await applicantApi.submit(details());
      clearDraft();
      applicantToken.clear();
      setStep('sent');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'APPLICANT_SESSION_EXPIRED' || code === 'APPLICANT_SESSION_REQUIRED') {
        sessionEnded();
      } else if (code === 'APPLICATION_PENDING' || code === 'RIDER_PENDING_APPROVAL') {
        const latest = await refresh();
        setStep(latest?.application ? 'status' : 'pending');
      } else if (code === 'ALREADY_APPROVED') {
        toSignIn({ notice: MESSAGES.ALREADY_APPROVED });
      } else {
        setError(errorMessage(err, 'Could not send your application.'));
        if (code === 'DOCUMENTS_REQUIRED') await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      const s = await applicantApi.state();
      setState(s);
      return s;
    } catch (err) {
      const code = errorCode(err);
      if (code === 'APPLICANT_SESSION_EXPIRED' || code === 'APPLICANT_SESSION_REQUIRED') sessionEnded();
      return null;
    }
  }

  function changed(docType: string, doc: RiderDocument | null) {
    setState((s) => {
      if (!s) return s;
      const others = s.documents.filter((d) => d.doc_type !== docType);
      return { ...s, documents: doc ? [...others, doc] : others };
    });
  }

  /** Every document this vehicle sees: required ones first. */
  function documentList(forVehicle: VehicleType | null, showStatus: boolean) {
    if (!state) return null;
    const types = documentsForVehicle(state.document_types, forVehicle).sort((a, b) => Number(b.required) - Number(a.required));
    if (types.length === 0) return <p className="apply__lead">No documents are needed.</p>;
    return (
      <div className="doc-list">
        {types.map((type) => (
          <DocumentCard
            key={type.key}
            type={type}
            doc={state.documents.find((d) => d.doc_type === type.key)}
            onChange={(doc) => changed(type.key, doc)}
            showStatus={showStatus}
          />
        ))}
      </div>
    );
  }

  const errorLine = error ? (
    <p className="login__error" role="alert">
      {error}
    </p>
  ) : null;

  let body;
  if (step === 'sent') {
    body = (
      <section className="apply-status" aria-labelledby="apply-sent">
        <span className="apply-status__tag apply-status__tag--done">Sent</span>
        <h1 id="apply-sent" className="login__title">
          Application sent
        </h1>
        <p className="apply-status__text" role="status">
          Ops will review it; you'll get an SMS when you're approved.
        </p>
        <div className="login__form">
          <button type="button" className="primary" onClick={() => toSignIn()}>
            Back to sign in
          </button>
        </div>
      </section>
    );
  } else if (step === 'pending') {
    body = (
      <PendingNotice>
        <button type="button" className="secondary" onClick={() => toSignIn()}>
          Back to sign in
        </button>
      </PendingNotice>
    );
  } else if (step === 'status' && state?.application) {
    const a = state.application;
    const rejectedDocs = state.documents.filter((d) => d.status === 'REJECTED');
    const docs = (
      <>
        {rejectedDocs.length ? (
          <p className="doc-alert" role="status">
            Ops couldn't accept {rejectedDocs.length === 1 ? rejectedDocs[0].label : `${rejectedDocs.length} documents`}. Upload{' '}
            {rejectedDocs.length === 1 ? 'it' : 'them'} again below.
          </p>
        ) : null}
        <h2 className="doc-list__title">Your documents</h2>
        {documentList(a.vehicle_type, true)}
        {errorLine}
      </>
    );
    if (a.status === 'REJECTED') {
      body = (
        <RejectedNotice reason={a.rejection_reason}>
          {docs}
          <button
            type="button"
            className="primary"
            onClick={() => {
              setError(null);
              setStep('details');
            }}
          >
            Apply again
          </button>
          <button type="button" className="text-button" onClick={() => toSignIn()}>
            Back to sign in
          </button>
        </RejectedNotice>
      );
    } else if (a.status === 'APPROVED') {
      body = (
        <section className="apply-status" aria-labelledby="apply-approved">
          <span className="apply-status__tag apply-status__tag--done">Approved</span>
          <h1 id="apply-approved" className="login__title">
            You're an approved rider
          </h1>
          <p className="apply-status__text">Sign in with this number to see your deliveries. Renewed a document? Upload it here.</p>
          <div className="login__form">
            {docs}
            <button type="button" className="primary" onClick={() => toSignIn()}>
              Sign in
            </button>
          </div>
        </section>
      );
    } else {
      body = (
        <PendingNotice>
          {docs}
          <button type="button" className="secondary" onClick={() => toSignIn()}>
            Back to sign in
          </button>
        </PendingNotice>
      );
    }
  } else if (step === 'documents' && state) {
    const types = documentsForVehicle(state.document_types, vehicle);
    const missing = types.filter((t) => t.required && !documentComplete(t, state.documents.find((d) => d.doc_type === t.key)));
    body = (
      <>
        <h1 className="login__title">Your documents</h1>
        <p className="apply__lead">
          Take a clear photo of each document, or choose one from your gallery. Ops checks them before approving you.
        </p>
        {documentList(vehicle, !!state.application)}
        {missing.length ? (
          <p className="doc-missing" role="status">
            Still needed: {missing.map((m) => m.label).join(', ')}
          </p>
        ) : null}
        {errorLine}
        <div className="login__form">
          <button type="button" className="primary" disabled={busy || missing.length > 0} onClick={() => void sendApplication()}>
            {busy ? 'Sending application…' : 'Send application'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError(null);
              setStep('details');
            }}
          >
            Back to your details
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="login__title">Apply to deliver</h1>
        <p className="apply__lead">
          {step === 'phone'
            ? "Start with your mobile number. We'll text you a code to check it's yours."
            : step === 'code'
              ? 'Enter the code we sent you.'
              : 'Tell us about you and your vehicle. Next, you add photos of your documents.'}
        </p>

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="login__form" noValidate>
            <label className="field" htmlFor={ids.phone}>
              <span className="field__label">Mobile number</span>
              <input
                id={ids.phone}
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07X XXX XXXX"
                required
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Please wait…' : 'Send code'}
            </button>
          </form>
        ) : step === 'code' ? (
          <form onSubmit={submitCode} className="login__form" noValidate>
            <p className="login__sent">
              We sent a code to <strong>{phone.trim()}</strong>.
            </p>
            <CodeField
              id={ids.otp}
              value={otp}
              onChange={setOtp}
              devOtp={devOtp}
              resendIn={resend.left}
              resending={resending}
              onResend={() => void resendCode()}
            />
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setStep('phone');
                setOtp('');
                setDevOtp(null);
                resend.clear();
                setError(null);
              }}
            >
              Use a different number
            </button>
          </form>
        ) : (
          <form onSubmit={submitDetails} className="login__form" noValidate>
            <label className="field" htmlFor={ids.name}>
              <span className="field__label">Full name</span>
              <input
                id={ids.name}
                className="input"
                autoComplete="name"
                autoCapitalize="words"
                maxLength={128}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </label>

            <fieldset className="choices">
              <legend className="field__label">Your vehicle</legend>
              <div className="choices__grid">
                {VEHICLES.map((v) => (
                  <label key={v.value} className={`choice${vehicle === v.value ? ' choice--on' : ''}`}>
                    <input
                      type="radio"
                      name="vehicle_type"
                      value={v.value}
                      checked={vehicle === v.value}
                      onChange={() => setVehicle(v.value)}
                    />
                    <span>{v.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field" htmlFor={ids.reg}>
              <span className="field__label">
                Registration number
                {vehicle === 'BICYCLE' ? <span className="field__optional"> (not needed for bicycles)</span> : null}
              </span>
              <input
                id={ids.reg}
                className="input input--upper"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                value={registration}
                onChange={(event) => setRegistration(event.target.value)}
                placeholder="e.g. WP BCD-1234"
                required={vehicle !== 'BICYCLE'}
              />
            </label>

            <label className="field" htmlFor={ids.emergency}>
              <span className="field__label">
                Emergency contact number <span className="field__optional">(optional)</span>
              </span>
              <input
                id={ids.emergency}
                className="input"
                type="tel"
                inputMode="tel"
                value={emergency}
                onChange={(event) => setEmergency(event.target.value)}
                placeholder="07X XXX XXXX"
              />
            </label>

            <button type="submit" className="primary">
              Next: your documents
            </button>
          </form>
        )}

        {errorLine}

        <p className="login__apply">
          Already a rider?{' '}
          <Link to="/login" state={{ phone: phone.trim() }}>
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <main className="login">
      <header className="login__head">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <span className="login__app">Rider</span>
      </header>
      <div className="login__body login__body--apply">{body}</div>
    </main>
  );
}
