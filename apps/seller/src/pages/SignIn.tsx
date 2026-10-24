import { useEffect, useState, type FormEvent } from 'react';
import { auth as authApi } from '../api/resources';
import { useAuth, SESSION_ENDED_MESSAGE } from '../auth/AuthContext';
import markUrl from '../assets/blynk-mark.png';
import { IconInfo, IconLock, IconPhone, IconPin, IconScooter, IconWallet } from '../components/icons';
import { ButtonArrow, Field, describedBy, Spinner } from '../components/ui';
import { isSellerNotRegistered, retryAfterSeconds, signInMessage } from '../lib/apiErrors';

/** Seconds before "send a new code" is allowed again. */
export const RESEND_SECONDS = 30;

export const NOT_REGISTERED_HINT = 'Not registered yet? Contact Blynk to add your shop.';

/** A Sri Lankan mobile or landline typed the usual ways: 0771234567, +94 77 123 4567, 94771234567. */
export function looksLikePhone(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return false;
  const digits = cleaned.replace(/^\+/, '');
  return digits.length >= 9 && digits.length <= 12;
}

const BENEFITS = [
  {
    icon: IconPin,
    title: 'Reach customers in Dharga Town & Aluthgama',
    text: 'Your products show in the Blynk app for homes nearby.',
  },
  {
    icon: IconScooter,
    title: 'Blynk delivers and collects the cash',
    text: 'Our riders pick up, deliver and take the payment.',
  },
  {
    icon: IconWallet,
    title: 'Get paid for what sells',
    text: 'Every sale and every payment is in your statement.',
  },
];

/**
 * Sign in to the seller portal. Sellers are invite-only: Blynk staff add the
 * shop with its phone number in Admin / Ops, and the seller signs in with that
 * number and the SMS code. Nothing is created from this screen; a number Blynk
 * has not registered is refused by the server (403 SELLER_NOT_REGISTERED).
 */
export function SignIn() {
  const { sessionEnded } = useAuth();

  return (
    <div className="signin">
      <aside className="signin__brand" aria-label="About Blynk Sellers">
        <div className="signin__brand-inner">
          <div className="lockup">
            <span className="lockup__tile">
              <img src={markUrl} alt="" width={26} height={31} />
            </span>
            <span className="lockup__name">
              Blynk <span>Sellers</span>
            </span>
          </div>

          <div className="signin__pitch">
            <p className="eyebrow eyebrow--brand">For local shops</p>
            <p className="signin__headline">
              Your shop, in every <span className="nowrap">home nearby.</span>
            </p>
            <p className="signin__lede-brand">
              Put your products on Blynk. We bring the customers, deliver the order and collect the cash.
            </p>
            <Benefits className="benefits benefits--panel" />
          </div>

          <Preview />
        </div>
      </aside>

      <main className="signin__main">
        <div className="signin__stack">
          <div className="shell">
            <div className="shell__core signin__card">
              <h1 className="signin__title">Sign in to Blynk Sellers</h1>
              <p className="muted signin__lede">
                Enter the mobile number Blynk registered for your shop. We&apos;ll text you a code.
              </p>

              {sessionEnded ? (
                <p className="notice notice--wait" role="status">
                  {SESSION_ENDED_MESSAGE}
                </p>
              ) : null}

              <PhoneSignIn />

              <p className="fine-print signin__invite">
                <IconInfo size={16} /> {NOT_REGISTERED_HINT}
              </p>
            </div>
          </div>

          <p className="signin__trust">
            <IconLock size={16} /> Only shops Blynk has registered can sign in.
          </p>

          <section className="signin__why" aria-label="Why sell on Blynk">
            <Benefits className="benefits benefits--card" />
          </section>
        </div>
      </main>
    </div>
  );
}

function Benefits({ className }: { className: string }) {
  return (
    <ul className={className}>
      {BENEFITS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="benefit">
          <span className="benefit__icon" aria-hidden="true">
            <Icon size={22} />
          </span>
          <span className="benefit__text">
            <strong>{title}</strong>
            <span>{text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A small, decorative picture of the portal (desktop brand panel only). */
function Preview() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview__card preview__card--product">
        <span className="preview__thumb" />
        <span className="preview__lines">
          <span className="preview__name">Kithul treacle</span>
          <span className="preview__meta">350 ml</span>
        </span>
        <span className="chip chip--ok">
          <span className="chip__dot" /> Live
        </span>
      </div>
      <div className="preview__card preview__card--due">
        <span className="preview__label">Blynk still owes you</span>
        <span className="preview__amount">LKR 12,450</span>
        <span className="preview__bar">
          <span />
        </span>
        <span className="preview__tag">Example</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- phone
function PhoneSignIn() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The number is not a registered seller: say so, and offer a different number. */
  const [notRegistered, setNotRegistered] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function showError(err: unknown) {
    setNotRegistered(isSellerNotRegistered(err));
    setError(signInMessage(err));
  }

  function clearError() {
    setError(null);
    setNotRegistered(false);
  }

  async function requestCode(): Promise<boolean> {
    clearError();
    setBusy(true);
    try {
      const result = await authApi.requestOtp(phone.trim());
      setDevOtp(result.dev_otp ?? null);
      setCooldown(RESEND_SECONDS);
      return true;
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (wait) setCooldown(wait);
      showError(err);
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
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6 numbers from the SMS.');
      return;
    }
    setCodeError(null);
    clearError();
    setBusy(true);
    try {
      await signIn(phone.trim(), code.trim());
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setCode('');
    await requestCode();
  }

  function changeNumber() {
    setStep('phone');
    setCode('');
    clearError();
  }

  return (
    <div className="panel-body">
      {error ? (
        <div className={`notice notice--bad${notRegistered ? ' notice--row signin__refused' : ''}`} role="alert">
          {notRegistered ? (
            <>
              <span className="notice__icon" aria-hidden="true">
                <IconInfo size={20} />
              </span>
              <div className="notice__body">
                <p>{error}</p>
                {step === 'code' ? (
                  <button type="button" className="button button--ghost button--small" onClick={changeNumber}>
                    <IconPhone size={16} /> Use a different number
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            error
          )}
        </div>
      ) : null}

      {step === 'phone' ? (
        <form onSubmit={sendCode} noValidate>
          <Field
            id="phone"
            label="Your mobile number"
            required
            error={phoneError}
            hint="The number Blynk registered for your shop."
          >
            <div className="input-affix">
              <span className="input-affix__icon" aria-hidden="true">
                <IconPhone size={20} />
              </span>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0771234567"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (notRegistered) clearError();
                }}
                aria-invalid={Boolean(phoneError) || notRegistered}
                aria-describedby={describedBy('phone', true, phoneError)}
              />
            </div>
          </Field>
          <button type="submit" className="button button--primary button--block button--cta" disabled={busy}>
            {busy ? <Spinner label="Sending" /> : null} Send me a code
            <ButtonArrow />
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <p className="sent-to">
            We sent a 6-number code to <strong>{phone.trim()}</strong>.{' '}
            <button type="button" className="button button--link" onClick={changeNumber}>
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
              className="input--code"
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
          <button type="submit" className="button button--primary button--block button--cta" disabled={busy}>
            {busy ? <Spinner label="Signing in" /> : null} Sign in
            <ButtonArrow />
          </button>
          <button
            type="button"
            className="button button--ghost button--block"
            disabled={cooldown > 0 || busy}
            onClick={() => void resend()}
          >
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </button>
        </form>
      )}
    </div>
  );
}
