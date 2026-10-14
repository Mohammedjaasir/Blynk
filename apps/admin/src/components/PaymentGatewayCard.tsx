import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { PaymentGatewayInput, PaymentGatewayMode, PaymentGatewaySetting, PaymentGatewayTestHash } from '../api/types';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import { formatDay } from '../lib/coupons';
import { formatClock } from '../lib/orders';
import { paymentGatewayErrorMessage } from '../lib/payments';
import { Switch } from './Switch';
import { Badge, Field, Spinner, useToast } from './ui';

/**
 * Settings -> Online payments (PayHere) (docs/api/payhere.md section 5;
 * GET/PATCH /admin/settings/payment-gateway). Cash on delivery stays the
 * default; customers see "Pay online" only while this is switched on and
 * fully configured ("Ready").
 *
 * The merchant secret is write-only: the API never returns it, the field is
 * never pre-filled, it is sent only when someone typed a new one, and it is
 * cleared after every save.
 */

const MIN_WINDOW = 5;
const MAX_WINDOW = 180;
const MAX_METHODS = 200;
const SECRET_MIN = 8;
const SECRET_MAX = 128;

const message = (err: unknown, fallback: string) => paymentGatewayErrorMessage(err) ?? errorMessage(err, fallback);

function when(iso: string): string {
  return `${formatDay(iso)} ${formatClock(iso)}`;
}

export function PaymentGatewayCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<PaymentGatewaySetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Checkout options (Admin and Operations).
  const [windowText, setWindowText] = useState('');
  const [methods, setMethods] = useState('');
  const [optionErrors, setOptionErrors] = useState<Record<string, string>>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [savingOptions, setSavingOptions] = useState(false);

  // On/off switch, saved at once.
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // Credentials (Admin only).
  const [mode, setMode] = useState<PaymentGatewayMode>('sandbox');
  const [merchantId, setMerchantId] = useState('');
  const [secret, setSecret] = useState('');
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});
  const [credError, setCredError] = useState<string | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);

  // Sample hash.
  const [hash, setHash] = useState<PaymentGatewayTestHash | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);

  function show(s: PaymentGatewaySetting) {
    setCurrent(s);
    setWindowText(String(s.payment_window_minutes));
    setMethods(s.allowed_methods ?? '');
    setMode(s.mode);
    setMerchantId(s.merchant_id ?? '');
    setSecret('');
  }

  useEffect(() => {
    let live = true;
    settings
      .getPaymentGateway()
      .then((s) => live && show(s))
      .catch((err) => live && setLoadError(message(err, 'Could not load the online payment settings.')));
    return () => {
      live = false;
    };
  }, []);

  async function toggle(on: boolean) {
    setSwitchError(null);
    setSwitching(true);
    try {
      const saved = await settings.setPaymentGateway({ enabled: on });
      setCurrent(saved);
      toast.success(saved.enabled ? 'Online payments are on.' : 'Online payments are off. Customers pay cash on delivery.');
    } catch (err) {
      setSwitchError(message(err, 'Could not change online payments.'));
    } finally {
      setSwitching(false);
    }
  }

  async function saveOptions(event: FormEvent) {
    event.preventDefault();
    setOptionsError(null);
    const local: Record<string, string> = {};
    const minutes = Number(windowText.trim());
    if (!/^\d+$/.test(windowText.trim()) || minutes < MIN_WINDOW || minutes > MAX_WINDOW) {
      local.payment_window_minutes = `Enter whole minutes from ${MIN_WINDOW} to ${MAX_WINDOW}.`;
    }
    if (methods.trim().length > MAX_METHODS) local.allowed_methods = `Keep it to ${MAX_METHODS} characters.`;
    setOptionErrors(local);
    if (Object.keys(local).length) return;
    setSavingOptions(true);
    try {
      const saved = await settings.setPaymentGateway({
        payment_window_minutes: minutes,
        allowed_methods: methods.trim() ? methods.trim() : null,
      });
      setCurrent(saved);
      setWindowText(String(saved.payment_window_minutes));
      setMethods(saved.allowed_methods ?? '');
      toast.success('Online payment options saved.');
    } catch (err) {
      const fields = fieldErrors(err);
      setOptionErrors(fields);
      setOptionsError(message(err, 'Could not save the online payment options.'));
    } finally {
      setSavingOptions(false);
    }
  }

  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    setCredError(null);
    const local: Record<string, string> = {};
    const id = merchantId.trim();
    if (id && !/^\d{1,32}$/.test(id)) local.merchant_id = 'The merchant ID is digits only (up to 32).';
    // The secret is sent only when someone typed one.
    const typed = secret.length > 0;
    if (typed && (secret.length < SECRET_MIN || secret.length > SECRET_MAX)) {
      local.merchant_secret = `The merchant secret is ${SECRET_MIN} to ${SECRET_MAX} characters.`;
    }
    setCredErrors(local);
    if (Object.keys(local).length) return;
    const body: PaymentGatewayInput = { mode };
    if (id) body.merchant_id = id;
    if (typed) body.merchant_secret = secret;
    setSavingCreds(true);
    try {
      const saved = await settings.setPaymentGateway(body);
      setCurrent(saved);
      setMode(saved.mode);
      setMerchantId(saved.merchant_id ?? '');
      setSecret('');
      setHash(null);
      toast.success(typed ? 'PayHere credentials saved. The new secret is stored encrypted.' : 'PayHere credentials saved.');
    } catch (err) {
      setCredErrors(fieldErrors(err));
      setCredError(message(err, 'Could not save the PayHere credentials.'));
    } finally {
      setSavingCreds(false);
    }
  }

  async function sampleHash() {
    setHashError(null);
    setHashing(true);
    try {
      setHash(await settings.testPaymentHash());
    } catch (err) {
      setHash(null);
      setHashError(message(err, 'Could not generate a sample hash.'));
    } finally {
      setHashing(false);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error('Could not copy. Select the address and copy it.');
    }
  }

  const canEdit = current?.can_edit_credentials ?? false;

  return (
    <section className="panel" id="online-payments" aria-label="Online payments (PayHere)">
      <h2 className="panel__title">Online payments (PayHere)</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the online payment settings" />
      ) : (
        <div className="form">
          <div className="pg-status" data-testid="payment-gateway-status">
            {current.ready ? <Badge tone="active">Ready</Badge> : <Badge tone="inactive">Not configured</Badge>}
            <Badge tone={current.mode === 'live' ? 'offer' : 'muted'}>{current.mode === 'live' ? 'Live' : 'Sandbox'}</Badge>
            <span className="cell__secondary">{current.enabled ? 'Offered at checkout' : 'Not offered - cash on delivery only'}</span>
          </div>

          {!current.encryption_key_configured ? (
            <p className="pg-warning" role="alert">
              Server is missing PAYMENT_SECRET_KEY - the secret cannot be saved
            </p>
          ) : null}

          <Switch label="Offer online payment at checkout" checked={current.enabled} disabled={switching} onChange={(on) => void toggle(on)}>
            Offer online payment at checkout
          </Switch>
          <p className="form__note">
            When on and Ready, customers can pay by card or wallet through PayHere. Cash on delivery always stays
            available. Unpaid online orders are never sent for packing and are cancelled when the payment window ends.
          </p>
          {switchError ? (
            <p className="field__error" role="alert">
              {switchError}
            </p>
          ) : null}

          <form className="form" onSubmit={saveOptions} noValidate aria-label="Online payment options">
            <Field
              label="Payment window (minutes)"
              hint={`How long a customer has to pay before the order is cancelled (${MIN_WINDOW}-${MAX_WINDOW}).`}
              error={optionErrors.payment_window_minutes}
            >
              <input
                className="input"
                inputMode="numeric"
                value={windowText}
                onChange={(e) => setWindowText(e.target.value)}
              />
            </Field>
            <Field
              label="Accepted methods note"
              hint="Shown to customers next to Pay online, e.g. Visa, Mastercard, eZ Cash."
              error={optionErrors.allowed_methods}
            >
              <input className="input" maxLength={MAX_METHODS} value={methods} onChange={(e) => setMethods(e.target.value)} />
            </Field>
            {optionsError ? (
              <p className="field__error" role="alert">
                {optionsError}
              </p>
            ) : null}
            <div className="form__actions">
              <button type="submit" className="button" disabled={savingOptions}>
                {savingOptions ? <Spinner label="Saving" /> : 'Save options'}
              </button>
            </div>
          </form>

          <form className="form" onSubmit={saveCredentials} noValidate aria-label="PayHere credentials">
            <h3 className="field__label">Credentials</h3>
            {!canEdit ? <p className="form__note">Only an Admin can change the PayHere credentials.</p> : null}
            <Field label="Mode">
              <select
                className="input"
                value={mode}
                disabled={!canEdit}
                onChange={(e) => setMode(e.target.value as PaymentGatewayMode)}
              >
                <option value="sandbox">Sandbox (test payments)</option>
                <option value="live">Live (real money)</option>
              </select>
            </Field>
            <Field label="Merchant ID" error={credErrors.merchant_id}>
              <input
                className="input mono"
                inputMode="numeric"
                maxLength={32}
                value={merchantId}
                readOnly={!canEdit}
                onChange={(e) => setMerchantId(e.target.value)}
              />
            </Field>
            <Field
              label="Merchant secret"
              hint={
                current.merchant_secret_set
                  ? `${current.merchant_secret_masked || '••••'} saved${
                      current.merchant_secret_updated_at ? `, last updated ${when(current.merchant_secret_updated_at)}` : ''
                    }`
                  : 'No secret saved yet.'
              }
              error={credErrors.merchant_secret}
            >
              {canEdit ? (
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  maxLength={SECRET_MAX}
                  placeholder="Enter new secret to replace"
                  value={secret}
                  disabled={!current.encryption_key_configured}
                  onChange={(e) => setSecret(e.target.value)}
                />
              ) : (
                <input className="input" readOnly value={current.merchant_secret_set ? 'Saved' : 'Not saved'} />
              )}
            </Field>
            {credError ? (
              <p className="field__error" role="alert">
                {credError}
              </p>
            ) : null}
            {canEdit ? (
              <div className="form__actions">
                <button type="submit" className="button" disabled={savingCreds}>
                  {savingCreds ? <Spinner label="Saving" /> : 'Save credentials'}
                </button>
              </div>
            ) : null}
          </form>

          <div className="pg-urls" role="group" aria-label="PayHere addresses">
            <p className="form__note">In the PayHere merchant portal add the domain/app and use this Notify URL.</p>
            {(
              [
                ['Notify URL', current.notify_url],
                ['Return URL', current.return_url],
                ['Cancel URL', current.cancel_url],
                ['Checkout URL', current.checkout_url],
              ] as const
            ).map(([label, url]) => (
              <div key={label}>
                <span className="field__label">{label}</span>
                <div className="pg-url">
                  <input className="input mono" readOnly value={url ?? ''} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Copy ${label}`}
                    disabled={!url}
                    onClick={() => void copy(url, label)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="form" role="group" aria-label="Sample hash">
            <div className="form__actions">
              <button type="button" className="button button--ghost" disabled={hashing} onClick={() => void sampleHash()}>
                {hashing ? <Spinner label="Generating" /> : 'Generate sample hash'}
              </button>
            </div>
            <p className="form__note">Checks the saved secret can be read. No call is made to PayHere.</p>
            {hashError ? (
              <p className="field__error" role="alert">
                {hashError}
              </p>
            ) : null}
            {hash ? (
              <dl className="pg-hash" data-testid="sample-hash">
                <dt>Order ID</dt>
                <dd className="mono">{hash.order_id}</dd>
                <dt>Amount</dt>
                <dd className="mono">{hash.amount}</dd>
                <dt>Currency</dt>
                <dd className="mono">{hash.currency}</dd>
                <dt>Hash</dt>
                <dd className="mono">{hash.hash}</dd>
              </dl>
            ) : null}
          </div>

          {current.updated_at ? <p className="form__note">Changed {when(current.updated_at)}.</p> : null}
        </div>
      )}
    </section>
  );
}
