import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { WRONG_ROLE_MESSAGE, useAuth } from '../auth/AuthContext';
import { Field, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import blynkLogo from '../assets/blynk-logo-light.png';

/**
 * Staff sign-in over the existing Blynk OTP flow. The account must be ADMIN
 * or PACKING_STAFF; anything else is refused here and, more importantly, by
 * the API on every inventory route.
 */
export function Login() {
  const { status, notice, requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();

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
    <div className="login">
      {/* Checked inline so production builds drop DevSkip entirely. */}
      {import.meta.env.DEV ? <DevSkip busy={busy} setBusy={setBusy} setError={setError} /> : null}

      <aside className="login__brand">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <p className="login__app">Inventory</p>
        <p className="login__blurb">Stock, the ledger, sourcing and suppliers for the Dharga Town store.</p>
      </aside>

      <div className="login__panel">
        <h1 className="login__title">Sign in</h1>
        <p className="login__subtitle">Use the phone number registered to your Blynk staff account.</p>

        {notice && !error ? (
          <p className="notice notice--warn" role="status">
            {notice}
          </p>
        ) : null}

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="login__form">
            <Field label="Mobile number" hint="10 digits, starting with 07">
              <input
                className="input"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07XXXXXXXX"
                required
              />
            </Field>
            <button type="submit" className="button" disabled={busy}>
              {busy ? <Spinner label="Sending code" /> : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="login__form">
            <Field label="6-digit code">
              <input
                className="input input--mono"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="000000"
                required
                autoFocus
              />
            </Field>
            {/* The API only returns this outside production. */}
            {devOtp ? <p className="login__dev">Dev code: {devOtp}</p> : null}
            <button type="submit" className="button" disabled={busy}>
              {busy ? <Spinner label="Verifying" /> : 'Verify and continue'}
            </button>
            <button
              type="button"
              className="button button--ghost"
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
    </div>
  );
}

/**
 * Development shortcut. Not an auth bypass: it runs the normal OTP flow for
 * VITE_DEV_INVENTORY_PHONE with the dev code the API only returns outside
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
  const phone = import.meta.env.VITE_DEV_INVENTORY_PHONE?.trim();
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
    <div className="login__skip">
      <span className="login__skip-tag">Dev</span>
      <button
        type="button"
        className="button button--sm login__skip-button"
        onClick={() => void skip(phone)}
        disabled={busy}
      >
        Skip sign-in
      </button>
    </div>
  );
}
