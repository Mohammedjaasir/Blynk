import { useState, type FormEvent, useId } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { isRoleRefusal, useAuth } from '../auth/AuthContext';
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
  const { signInWithPassword } = useAuth();
  const navigate = useNavigate();

  // Staff sign in with their email and password by default (backend
  // migration 012); an SMS code stays available for anyone without a
  // password, or locked out.
  const emailId = useId();
  const passwordId = useId();
  const [method, setMethod] = useState<'password' | 'sms'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The password is sent exactly as typed; only the email is tidied.
      await signInWithPassword(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setPassword('');
      setError(
        isRoleRefusal(err)
          ? err.message
          : (passwordSignInError(err) ?? errorMessage(err, 'Could not sign in.'))
      );
    } finally {
      setBusy(false);
    }
  }

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
      if (isRoleRefusal(err)) {
        setStep('phone');
        setOtp('');
        setDevOtp(null);
        setError(err.message);
      } else {
        setError(errorMessage(err, 'Could not verify the code.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">

      <aside className="login__brand">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <p className="login__app">Inventory</p>
        <p className="login__blurb">Stock, the ledger, sourcing and suppliers for the Dharga Town store.</p>
      </aside>

      <div className="login__panel">
        <h1 className="login__title">Sign in</h1>
        <p className="login__subtitle">
          {method === 'password'
            ? 'Use the email and password of your Blynk staff account.'
            : 'Use the phone number registered to your Blynk staff account.'}
        </p>

        {notice && !error ? (
          <p className="notice notice--warn" role="status">
            {notice}
          </p>
        ) : null}

        {method === 'password' ? (
          <form onSubmit={submitPassword} className="login__form">
            <div className="field">
              <label className="field__label" htmlFor={emailId}>
                Email
              </label>
              <input
                id={emailId}
                className="input"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={passwordId}>
                Password
              </label>
              <div className="password-input">
                <input
                  id={passwordId}
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-input__toggle"
                  aria-controls={passwordId}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button type="submit" className="button" disabled={busy} aria-busy={busy}>
              {busy ? <Spinner label="Signing in" /> : 'Sign in'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setMethod('sms');
                setPassword('');
                setShowPassword(false);
                setError(null);
              }}
            >
              Use an SMS code instead
            </button>
          </form>
        ) : null}

        {method === 'sms' ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setMethod('password');
              setStep('phone');
              setError(null);
            }}
          >
            Use email and password instead
          </button>
        ) : null}

        {method === 'password' ? null : step === 'phone' ? (
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
 * The staff's words for the two refusals of an email + password sign-in
 * (backend migration 012). null means "not one of these" - use the caller's
 * usual message.
 */
function passwordSignInError(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'INVALID_CREDENTIALS') return 'Wrong email or password.';
  if (err.code === 'LOGIN_LOCKED') {
    const minutes = (err.details as { retry_after_minutes?: number } | null)?.retry_after_minutes ?? 15;
    return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  return null;
}
