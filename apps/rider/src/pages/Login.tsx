import { useId, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { WRONG_ROLE_MESSAGE, useAuth } from '../auth/AuthContext';
import { errorMessage } from '../lib/errors';
import blynkLogo from '../assets/blynk-logo-light.png';

/**
 * Rider sign-in over the existing Blynk OTP flow. The account must be a
 * RIDER; anything else is refused here and, more importantly, by the API on
 * every rider route.
 */
export function Login() {
  const { status, notice, requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const phoneId = useId();
  const otpId = useId();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { devOtp: code } = await requestOtp(phone.trim());
      setDevOtp(code ?? null);
      setStep('otp');
    } catch (err) {
      setError(errorMessage(err, 'Could not send the code.'));
    } finally {
      setBusy(false);
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
      // A refused role has already used up the code, so go back to the
      // phone step rather than inviting a retry that can only fail.
      if (err instanceof Error && err.message === WRONG_ROLE_MESSAGE) {
        setStep('phone');
        setOtp('');
        setDevOtp(null);
        setError(WRONG_ROLE_MESSAGE);
      } else {
        setError(errorMessage(err, 'Could not verify the code.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <header className="login__head">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <span className="login__app">Rider</span>
        {/* Checked inline so production builds drop DevSkip entirely. */}
        {import.meta.env.DEV ? <DevSkip busy={busy} setBusy={setBusy} setError={setError} /> : null}
      </header>

      <div className="login__body">
        <h1 className="login__title">Sign in to your deliveries</h1>

        {notice && !error ? (
          <p className="banner" role="status">
            {notice}
          </p>
        ) : null}

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="login__form">
            <label className="field" htmlFor={phoneId}>
              <span className="field__label">Mobile number</span>
              <input
                id={phoneId}
                className="input"
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
          <form onSubmit={submitOtp} className="login__form">
            <label className="field" htmlFor={otpId}>
              <span className="field__label">6-digit code</span>
              <input
                id={otpId}
                className="input input--code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, ''))}
                required
                autoFocus
              />
            </label>
            {/* The API only returns this outside production. */}
            {devOtp ? <p className="login__dev">Dev code: {devOtp}</p> : null}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setStep('phone');
                setOtp('');
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
      </div>
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
