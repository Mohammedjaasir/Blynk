import { useEffect, useState, type FormEvent } from 'react';
import { auth as authApi } from '../api/resources';
import { useAuth, SESSION_ENDED_MESSAGE } from '../auth/AuthContext';
import markUrl from '../assets/blynk-mark.png';
import { Field, describedBy, Spinner } from '../components/ui';
import { retryAfterSeconds, signInMessage } from '../lib/apiErrors';

/** Seconds before "send a new code" is allowed again. */
export const RESEND_SECONDS = 30;

/** A Sri Lankan mobile or landline typed the usual ways: 0771234567, +94 77 123 4567, 94771234567. */
export function looksLikePhone(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return false;
  const digits = cleaned.replace(/^\+/, '');
  return digits.length >= 9 && digits.length <= 12;
}

/**
 * Sign in with a phone number and the SMS code. There is no password.
 * First time here: the same screen asks for the shop name, which creates the
 * shop (Blynk then approves it).
 */
export function SignIn() {
  const { signIn, sessionEnded } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [shopName, setShopName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shopError, setShopError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const result = await authApi.requestOtp(phone.trim());
      setDevOtp(result.dev_otp ?? null);
      setCooldown(RESEND_SECONDS);
      return true;
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (wait) setCooldown(wait);
      setError(signInMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!looksLikePhone(phone)) {
      setPhoneError('Enter your mobile number, like 0771234567.');
      return;
    }
    setPhoneError(null);
    if (await requestCode()) {
      setCode('');
      setStep('code');
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    let bad = false;
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6 numbers from the SMS.');
      bad = true;
    } else {
      setCodeError(null);
    }
    const name = shopName.trim();
    if (name && (name.length < 2 || name.length > 80)) {
      setShopError('The shop name must be 2 to 80 letters.');
      bad = true;
    } else {
      setShopError(null);
    }
    if (bad) return;

    setError(null);
    setBusy(true);
    try {
      await signIn(phone.trim(), code.trim(), name || undefined);
    } catch (err) {
      setError(signInMessage(err));
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setCode('');
    await requestCode();
  }

  return (
    <div className="signin">
      <div className="signin__card">
        <img src={markUrl} alt="" width={44} height={52} className="signin__mark" />
        <h1>Blynk Sellers</h1>
        <p className="muted">Sell your products on Blynk. Sign in with your phone number - no password needed.</p>

        {sessionEnded ? (
          <p className="notice notice--wait" role="status">
            {SESSION_ENDED_MESSAGE}
          </p>
        ) : null}
        {error ? (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        ) : null}

        {step === 'phone' ? (
          <form onSubmit={sendCode} noValidate>
            <Field id="phone" label="Your mobile number" required error={phoneError} hint="We will send you a code by SMS.">
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0771234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(phoneError)}
                aria-describedby={describedBy('phone', true, phoneError)}
              />
            </Field>
            <button type="submit" className="button button--primary button--block" disabled={busy}>
              {busy ? <Spinner label="Sending" /> : null} Send me a code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} noValidate>
            <p>
              We sent a 6-number code to <strong>{phone.trim()}</strong>.{' '}
              <button
                type="button"
                className="button button--link"
                onClick={() => {
                  setStep('phone');
                  setError(null);
                }}
              >
                Wrong number?
              </button>
            </p>
            {devOtp ? (
              <p className="notice notice--wait" role="status">
                Test code (only shown while testing): <strong>{devOtp}</strong>
              </p>
            ) : null}
            <Field id="code" label="The 6-number code" required error={codeError}>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-invalid={Boolean(codeError)}
                aria-describedby={describedBy('code', false, codeError)}
              />
            </Field>
            <Field
              id="shop-name"
              label="Your shop name"
              error={shopError}
              hint="First time here? Tell us your shop name. If you already have a shop, leave this empty."
            >
              <input
                id="shop-name"
                name="shop_name"
                type="text"
                autoComplete="organization"
                maxLength={80}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                aria-invalid={Boolean(shopError)}
                aria-describedby={describedBy('shop-name', true, shopError)}
              />
            </Field>
            <button type="submit" className="button button--primary button--block" disabled={busy}>
              {busy ? <Spinner label="Signing in" /> : null} Sign in
            </button>
            <button type="button" className="button button--ghost button--block" disabled={cooldown > 0 || busy} onClick={() => void resend()}>
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
