import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { auth as authApi } from '../api/resources';
import { useAuth, SESSION_ENDED_MESSAGE } from '../auth/AuthContext';
import markUrl from '../assets/blynk-mark.png';
import {
  IconCheckCircle,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconLock,
  IconMail,
  IconPhone,
  IconPin,
  IconScooter,
  IconWallet,
} from '../components/icons';
import { ButtonArrow, Field, describedBy, Spinner } from '../components/ui';
import {
  emailAuthMessage,
  fieldErrors,
  isEmailInUse,
  retryAfterSeconds,
  signInMessage,
} from '../lib/apiErrors';

/** Seconds before "send a new code" is allowed again. */
export const RESEND_SECONDS = 30;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const FORGOT_PASSWORD_NOTE = 'Sign in with your phone number instead, or ask Blynk to reset it.';

/** A Sri Lankan mobile or landline typed the usual ways: 0771234567, +94 77 123 4567, 94771234567. */
export function looksLikePhone(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return false;
  const digits = cleaned.replace(/^\+/, '');
  return digits.length >= 9 && digits.length <= 12;
}

/** Good enough to catch a typo; the server has the final say. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export interface PasswordStrength {
  /** 0 too short or too long, 1 weak, 2 good, 3 strong. */
  level: 0 | 1 | 2 | 3;
  label: string;
}

/** A plain-words hint while a new password is typed. */
export function passwordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  if (password.length < PASSWORD_MIN) return { level: 0, label: `Too short - use at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX) return { level: 0, label: `Too long - ${PASSWORD_MAX} characters at most.` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && kinds >= 3) return { level: 3, label: 'Strong password.' };
  if (password.length >= 10 || kinds >= 3) return { level: 2, label: 'Good password.' };
  return { level: 1, label: 'Weak - add numbers or symbols, or make it longer.' };
}

type Tab = 'phone' | 'email';
type EmailMode = 'signin' | 'create';

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
 * Sign in to the seller portal, two ways:
 *  - Phone: the SMS code (no password). First time here, the same screen asks
 *    for the shop name, which creates the shop.
 *  - Email: sign in with an email and password, or create an account with an
 *    email, password and shop name.
 * Blynk approves every new shop before it can sell.
 */
export function SignIn() {
  const { sessionEnded } = useAuth();
  const [tab, setTab] = useState<Tab>('phone');
  const [emailMode, setEmailMode] = useState<EmailMode>('signin');
  const phoneTabRef = useRef<HTMLButtonElement>(null);
  const emailTabRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const tabId = (t: Tab) => `${ids}-tab-${t}`;
  const panelId = (t: Tab) => `${ids}-panel-${t}`;

  function choose(next: Tab, focus = false) {
    setTab(next);
    if (focus) (next === 'phone' ? phoneTabRef : emailTabRef).current?.focus();
  }

  // Arrow keys move between the two tabs (the usual tablist keyboard pattern).
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next: Tab =
        event.key === 'Home' ? 'phone' : event.key === 'End' ? 'email' : tab === 'phone' ? 'email' : 'phone';
      choose(next, true);
    }
  }

  const creating = tab === 'email' && emailMode === 'create';
  const lede =
    tab === 'phone'
      ? 'Use your mobile number. We send you a code by SMS - no password needed.'
      : creating
        ? 'New to Blynk? Set up your shop in a minute. Blynk checks and approves every new shop.'
        : 'Use the email and password you signed up with.';

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
              <h1 className="signin__title">
                {creating ? 'Create your Blynk Sellers account' : 'Sign in to Blynk Sellers'}
              </h1>
              <p className="muted signin__lede">{lede}</p>

              {sessionEnded ? (
                <p className="notice notice--wait" role="status">
                  {SESSION_ENDED_MESSAGE}
                </p>
              ) : null}

              <div
                className="segmented"
                role="tablist"
                aria-label="How to sign in"
                style={{ ['--index' as string]: tab === 'phone' ? 0 : 1 }}
                onKeyDown={onTabKey}
              >
                <span className="segmented__thumb" aria-hidden="true" />
                <button
                  ref={phoneTabRef}
                  type="button"
                  role="tab"
                  id={tabId('phone')}
                  aria-selected={tab === 'phone'}
                  aria-controls={panelId('phone')}
                  tabIndex={tab === 'phone' ? 0 : -1}
                  className="segmented__option"
                  onClick={() => choose('phone')}
                >
                  <IconPhone size={18} /> Phone
                </button>
                <button
                  ref={emailTabRef}
                  type="button"
                  role="tab"
                  id={tabId('email')}
                  aria-selected={tab === 'email'}
                  aria-controls={panelId('email')}
                  tabIndex={tab === 'email' ? 0 : -1}
                  className="segmented__option"
                  onClick={() => choose('email')}
                >
                  <IconMail size={18} /> Email
                </button>
              </div>

              {/* Both stay mounted, so switching tabs never loses a code that was just sent. */}
              <div role="tabpanel" id={panelId('phone')} aria-labelledby={tabId('phone')} hidden={tab !== 'phone'}>
                <PhoneSignIn />
              </div>
              <div role="tabpanel" id={panelId('email')} aria-labelledby={tabId('email')} hidden={tab !== 'email'}>
                <EmailSignIn mode={emailMode} onMode={setEmailMode} onUsePhone={() => choose('phone', true)} />
              </div>
            </div>
          </div>

          <p className="signin__trust">
            <IconLock size={16} /> Blynk checks every shop before it can sell.
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

function Notice({ tone, children, role = 'status' }: { tone: 'bad' | 'wait' | 'info'; children: ReactNode; role?: string }) {
  return (
    <div className={`notice notice--${tone} notice--row`} role={role}>
      <span className="notice__icon" aria-hidden="true">
        <IconInfo size={20} />
      </span>
      <div className="notice__body">{children}</div>
    </div>
  );
}

// -------------------------------------------------------------------- phone
function PhoneSignIn() {
  const { signIn } = useAuth();
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
    <div className="panel-body">
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}

      {step === 'phone' ? (
        <form onSubmit={sendCode} noValidate>
          <Field id="phone" label="Your mobile number" required error={phoneError} hint="We will send you a code by SMS.">
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
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(phoneError)}
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

// -------------------------------------------------------------------- email
type EmailErrors = Partial<Record<'email' | 'password' | 'shop_name', string>>;

function EmailSignIn({
  mode,
  onMode,
  onUsePhone,
}: {
  mode: EmailMode;
  onMode(mode: EmailMode): void;
  onUsePhone(): void;
}) {
  const { signInWithEmail, registerWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shopName, setShopName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInUse, setEmailInUse] = useState(false);
  const [errors, setErrors] = useState<EmailErrors>({});
  const [forgotOpen, setForgotOpen] = useState(false);
  const creating = mode === 'create';
  const strength = creating ? passwordStrength(password) : null;

  function switchMode(next: EmailMode) {
    if (next === mode) return;
    onMode(next);
    setError(null);
    setEmailInUse(false);
    setErrors({});
    setForgotOpen(false);
  }

  function check(): EmailErrors {
    const found: EmailErrors = {};
    if (!looksLikeEmail(email)) found.email = 'Enter your email address, like name@example.com.';
    if (creating) {
      if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        found.password = `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters for your password.`;
      }
      const name = shopName.trim();
      if (name.length < 2 || name.length > 80) found.shop_name = 'Enter your shop name (2 to 80 letters).';
    } else if (!password) {
      found.password = 'Enter your password.';
    }
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setError(null);
    setEmailInUse(false);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      if (creating) await registerWithEmail(email.trim(), password, shopName.trim());
      else await signInWithEmail(email.trim(), password);
      // Signed in: the router moves on to the products screen.
    } catch (err) {
      const server = fieldErrors(err);
      const mapped: EmailErrors = {};
      for (const key of ['email', 'password', 'shop_name'] as const) {
        if (server[key]) mapped[key] = server[key];
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped);
        setError('Please fix the highlighted boxes.');
      } else {
        setEmailInUse(creating && isEmailInUse(err));
        setError(emailAuthMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <div className="panel-body">
      <div className="mode-switch" role="tablist" aria-label="Email options">
        <button
          type="button"
          role="tab"
          aria-selected={!creating}
          className="mode-switch__option"
          onClick={() => switchMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={creating}
          className="mode-switch__option"
          onClick={() => switchMode('create')}
        >
          Create account
        </button>
      </div>

      {error ? (
        <div className="notice notice--bad" role="alert">
          <p>{error}</p>
          {emailInUse ? (
            <button type="button" className="button button--ghost button--small" onClick={() => switchMode('signin')}>
              Sign in instead
            </button>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email address" required error={errors.email}>
          <div className="input-affix">
            <span className="input-affix__icon" aria-hidden="true">
              <IconMail size={20} />
            </span>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete={creating ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy('email', false, errors.email)}
            />
          </div>
        </Field>

        <Field
          id="password"
          label="Password"
          required
          error={errors.password}
          hint={creating ? `${PASSWORD_MIN} to ${PASSWORD_MAX} characters. A longer password is safer.` : undefined}
        >
          <div className="input-affix input-affix--end">
            <span className="input-affix__icon" aria-hidden="true">
              <IconLock size={20} />
            </span>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={creating ? 'new-password' : 'current-password'}
              autoCapitalize="none"
              spellCheck={false}
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                [describedBy('password', creating, errors.password), strength ? 'password-strength' : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            <button
              type="button"
              className="input-affix__toggle"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="password"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <IconEyeOff size={20} /> : <IconEye size={20} />}
            </button>
          </div>
          {strength ? (
            <div className={`strength strength--${strength.level}`} id="password-strength" aria-live="polite">
              <span className="strength__bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="strength__label">{strength.label}</span>
            </div>
          ) : null}
        </Field>

        {!creating ? (
          <div className="forgot">
            <button
              type="button"
              className="button button--link forgot__link"
              aria-expanded={forgotOpen}
              onClick={() => setForgotOpen((v) => !v)}
            >
              Forgot password?
            </button>
            {forgotOpen ? (
              <Notice tone="info">
                <p>{FORGOT_PASSWORD_NOTE}</p>
                <button type="button" className="button button--ghost button--small" onClick={onUsePhone}>
                  <IconPhone size={16} /> Use my phone number
                </button>
              </Notice>
            ) : null}
          </div>
        ) : null}

        {creating ? (
          <Field
            id="email-shop-name"
            label="Shop name"
            required
            error={errors.shop_name}
            hint="The name customers will know you by. You can change it later."
          >
            <input
              id="email-shop-name"
              name="shop_name"
              type="text"
              autoComplete="organization"
              maxLength={80}
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              aria-invalid={Boolean(errors.shop_name)}
              aria-describedby={describedBy('email-shop-name', true, errors.shop_name)}
            />
          </Field>
        ) : null}

        <button type="submit" className="button button--primary button--block button--cta" disabled={busy}>
          {busy ? <Spinner label={creating ? 'Creating your account' : 'Signing in'} /> : null}{' '}
          {creating ? 'Create my account' : 'Sign in'}
          <ButtonArrow />
        </button>

        {creating ? (
          <p className="fine-print">
            <IconCheckCircle size={16} /> Blynk will check your shop and approve it before you can add products.
          </p>
        ) : null}
      </form>
    </div>
  );
}
