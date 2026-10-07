import { useState, type FormEvent, useId } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { isRoleRefusal, useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import blynkLogo from '../assets/blynk-logo-light.png';

/**
 * Staff sign-in: email + password only (owner, 2026-10-07). Inventory and
 * Admin accounts have no phone number and are never sent an SMS code
 * (backend migration 028). The account must be ADMIN or PACKING_STAFF;
 * anything else is refused here and, more importantly, by the API on every
 * inventory route.
 */
export function Login() {
  const { status, notice, signInWithPassword } = useAuth();
  const navigate = useNavigate();

  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  return (
    <div className="login">

      <aside className="login__brand">
        <img className="login__logo" src={blynkLogo} alt="Blynk" />
        <p className="login__app">Inventory</p>
        <p className="login__blurb">Stock, the ledger, sourcing and suppliers for the Dharga Town store.</p>
      </aside>

      <div className="login__panel">
        <h1 className="login__title">Sign in</h1>
        <p className="login__subtitle">Use the email and password of your Blynk staff account.</p>

        {notice && !error ? (
          <p className="notice notice--warn" role="status">
            {notice}
          </p>
        ) : null}

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
          <p className="login__hint">Forgot your password? Ask an admin to reset it.</p>
        </form>

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
