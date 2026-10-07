import { useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { WRONG_ROLE_MESSAGE, useAuth } from '../auth/AuthContext';
import { CodeField, PendingNotice, RejectedNotice } from '../components/ApplicationNotice';
import { errorCode, errorMessage } from '../lib/errors';
import { CODE_SPENT, PHONE_FORMAT_MESSAGE, isSriLankanMobile, rejectionReason, useResendTimer } from '../lib/otp';
import blynkLogo from '../assets/blynk-logo-light.png';

/** What /login can be opened with, e.g. from the application flow. */
export interface LoginState {
  phone?: string;
  notice?: string;
}

type Outcome =
  | { kind: 'not-found' }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason: string | null }
  | null;

/**
 * Rider sign-in: phone number, then the SMS code - nothing else (owner,
 * 2026-10-07). Riders apply in this app and Ops or Admin approve them; the
 * API refuses a rider's email + password (PHONE_SIGN_IN_REQUIRED). The
 * account must be a RIDER; anything else is refused here and, more
 * importantly, by the API on every rider route.
 */
export function Login() {
  const { status, notice, requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const opened = (location.state as LoginState | null) ?? {};
  const phoneId = useId();
  const otpId = useId();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState(opened.phone ?? '');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const resend = useResendTimer();

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const shownNotice = opened.notice ?? notice;

  function backToPhone() {
    setStep('phone');
    setOtp('');
    setDevOtp(null);
    resend.clear();
  }

  /** The answers that end this sign-in attempt: no code can change them. */
  function settle(err: unknown): boolean {
    const code = errorCode(err);
    if (code === 'RIDER_PENDING_APPROVAL') {
      backToPhone();
      setOutcome({ kind: 'pending' });
      return true;
    }
    if (code === 'RIDER_APPLICATION_REJECTED') {
      backToPhone();
      setOutcome({ kind: 'rejected', reason: rejectionReason(err) });
      return true;
    }
    return false;
  }

  async function sendCode() {
    const { devOtp: code } = await requestOtp(phone.trim());
    setDevOtp(code ?? null);
    resend.start();
  }

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOutcome(null);
    if (!isSriLankanMobile(phone)) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      await sendCode();
      setStep('otp');
    } catch (err) {
      if (!settle(err)) setError(errorMessage(err, 'Could not send the code.'));
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
      if (!settle(err)) setError(errorMessage(err, 'Could not send the code.'));
    } finally {
      setResending(false);
    }
  }

  async function submitOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone.trim(), otp.trim());
      navigate('/', { replace: true });
    } catch (err) {
      if (settle(err)) return;
      if (err instanceof ApiError && err.code === 'ACCOUNT_NOT_FOUND') {
        // No rider uses this number: another code can't help; applying can.
        backToPhone();
        setOutcome({ kind: 'not-found' });
      } else if (err instanceof Error && err.message === WRONG_ROLE_MESSAGE) {
        // A refused role has already used up the code, so go back to the
        // phone step rather than inviting a retry that can only fail.
        backToPhone();
        setError(WRONG_ROLE_MESSAGE);
      } else {
        if (CODE_SPENT.has(errorCode(err) ?? '')) {
          setOtp('');
          resend.clear();
        }
        setError(errorMessage(err, 'Could not verify the code.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const apply = () => navigate('/apply', { state: { phone: phone.trim() } });

  function startOver() {
    setOutcome(null);
    setError(null);
  }

  let body;
  if (outcome?.kind === 'pending') {
    body = (
      <PendingNotice>
        <button type="button" className="secondary" onClick={startOver}>
          Back to sign in
        </button>
      </PendingNotice>
    );
  } else if (outcome?.kind === 'rejected') {
    body = (
      <RejectedNotice reason={outcome.reason}>
        <button type="button" className="primary" onClick={apply}>
          Apply again
        </button>
        <button type="button" className="text-button" onClick={startOver}>
          Back to sign in
        </button>
      </RejectedNotice>
    );
  } else {
    body = (
      <>
        <h1 className="login__title">Sign in to your deliveries</h1>

        {shownNotice && !error && !outcome ? (
          <p className="banner" role="status">
            {shownNotice}
          </p>
        ) : null}

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="login__form" noValidate>
            <label className="field" htmlFor={phoneId}>
              <span className="field__label">Mobile number</span>
              <input
                id={phoneId}
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  if (outcome) setOutcome(null);
                }}
                placeholder="07X XXX XXXX"
                required
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="login__form">
            <p className="login__sent">
              We sent a code to <strong>{phone.trim()}</strong>.
            </p>
            <CodeField
              id={otpId}
              value={otp}
              onChange={setOtp}
              devOtp={devOtp}
              resendIn={resend.left}
              resending={resending}
              onResend={() => void resendCode()}
            />
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                backToPhone();
                setError(null);
              }}
            >
              Use a different number
            </button>
          </form>
        )}

        {outcome?.kind === 'not-found' ? (
          <div className="login__notfound" role="alert">
            <p>No rider account uses this number.</p>
            <button type="button" className="primary" onClick={apply}>
              Apply to deliver
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        {outcome?.kind === 'not-found' ? null : (
          <p className="login__apply">
            New rider?{' '}
            <Link to="/apply" state={{ phone: phone.trim() }}>
              Apply to deliver
            </Link>
          </p>
        )}
      </>
    );
  }

  return (
    <main className="login">
      <header className="login__head">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <span className="login__app">Rider</span>
        {/* Checked inline so production builds drop DevSkip entirely. */}
        {import.meta.env.DEV ? <DevSkip busy={busy} setBusy={setBusy} setError={setError} /> : null}
      </header>

      <div className="login__body">{body}</div>
    </main>
  );
}

/**
 * Development shortcut. Not an auth bypass: it runs the normal OTP flow for
 * VITE_DEV_RIDER_PHONE with the dev code the API only returns outside
 * production, and the session is checked by the API like any other. Renders
 * nothing unless that variable is set; absent from production bundles.
 */
function DevSkip({
  busy,
  setBusy,
  setError,
}: {
  busy: boolean;
  setBusy(value: boolean): void;
  setError(value: string | null): void;
}) {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const phone = import.meta.env.VITE_DEV_RIDER_PHONE?.trim();
  if (!phone) return null;

  async function skip(devPhone: string) {
    setError(null);
    setBusy(true);
    try {
      const { devOtp: code } = await requestOtp(devPhone);
      if (!code) throw new Error('Skip only works against a development API.');
      await verifyOtp(devPhone, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error && !('status' in err) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="login__skip">
      <span className="login__skip-tag">Dev</span>
      <button type="button" className="login__skip-button" onClick={() => void skip(phone)} disabled={busy}>
        Skip sign-in
      </button>
    </span>
  );
}
