import { useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { applicationsApi } from '../api/resources';
import type { RiderApplicationInput, VehicleType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CodeField, PendingNotice } from '../components/ApplicationNotice';
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

/**
 * Apply to deliver (owner, 2026-10-07): riders apply here, Ops or Admin
 * approve, then the rider signs in with their phone and an SMS code.
 *
 * 1. phone -> SMS code (proves the number; no account is made)
 * 2. code + name + vehicle + registration (+ emergency contact)
 *    -> POST /riders/applications
 * 3. "Application sent", or the waiting screen when one is already pending.
 */
export function Apply() {
  const { status, requestOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { phone?: string } | null)?.phone ?? '';
  const ids = { phone: useId(), otp: useId(), name: useId(), reg: useId(), emergency: useId() };

  const [step, setStep] = useState<'phone' | 'details' | 'sent' | 'pending'>('phone');
  const [phone, setPhone] = useState(prefill);
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [vehicle, setVehicle] = useState<VehicleType | null>(null);
  const [registration, setRegistration] = useState('');
  const [emergency, setEmergency] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resend = useResendTimer();

  // A saved session (even one that can't be checked offline) belongs on the queue.
  if (status === 'authenticated' || status === 'offline') return <Navigate to="/" replace />;

  const toSignIn = (state: LoginState = {}) => navigate('/login', { state: { phone: phone.trim(), ...state } });

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
      setStep('details');
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

  /** The rider's own mistakes, caught before the code is spent. */
  function checkDetails(): string | null {
    if (otp.length !== OTP_LENGTH) return 'Enter the 6-digit code from the SMS.';
    const name = fullName.trim();
    if (name.length < 2 || name.length > 128) return 'Enter your full name (2 to 128 letters).';
    if (!vehicle) return 'Choose your vehicle.';
    if (!registration.trim() && vehicle !== 'BICYCLE') return "Enter your vehicle's registration number.";
    if (emergency.trim() && !isSriLankanMobile(emergency)) {
      return 'Enter the emergency contact as a Sri Lankan mobile number, like 077 123 4567.';
    }
    return null;
  }

  async function submitApplication(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = checkDetails();
    if (problem) {
      setError(problem);
      return;
    }
    const input: RiderApplicationInput = {
      phone: phone.trim(),
      otp,
      full_name: fullName.trim(),
      vehicle_type: vehicle as VehicleType,
    };
    // Bicycles have no registration: left out when empty (required for every other type).
    if (registration.trim()) input.vehicle_registration_number = registration.trim().toUpperCase();
    if (emergency.trim()) input.emergency_contact_phone = emergency.trim();
    setBusy(true);
    try {
      await applicationsApi.submit(input);
      setStep('sent');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'APPLICATION_PENDING' || code === 'RIDER_PENDING_APPROVAL') {
        setStep('pending');
      } else if (code === 'ALREADY_APPROVED') {
        toSignIn({ notice: MESSAGES.ALREADY_APPROVED });
      } else {
        if (CODE_SPENT.has(code ?? '')) {
          setOtp('');
          resend.clear();
        }
        setError(errorMessage(err, 'Could not send your application.'));
      }
    } finally {
      setBusy(false);
    }
  }

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
  } else {
    body = (
      <>
        <h1 className="login__title">Apply to deliver</h1>
        <p className="apply__lead">
          {step === 'phone'
            ? "Start with your mobile number. We'll text you a code to check it's yours."
            : 'Tell us about you and your vehicle. Ops will review your application.'}
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
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitApplication} className="login__form" noValidate>
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

            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Sending application…' : 'Send application'}
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
        )}

        {error ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

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
