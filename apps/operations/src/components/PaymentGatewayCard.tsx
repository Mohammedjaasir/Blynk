import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { PaymentGatewayInput, PaymentGatewaySetting, PaymentGatewayTestHash } from '../api/types';
import { Switch } from './RiderDocuments';
import { Spinner, Status } from './ui';
import { formatDateTime } from '../lib/inventory';
import { parseWindowMinutes, paymentGatewayErrorMessage } from '../lib/payments';

type Mode = PaymentGatewaySetting['mode'];

const MODE_TEXT: Record<Mode, string> = { sandbox: 'Sandbox', live: 'Live' };

const URL_ROWS: ReadonlyArray<{ key: 'notify_url' | 'return_url' | 'cancel_url' | 'checkout_url'; label: string }> = [
  { key: 'notify_url', label: 'Notify URL' },
  { key: 'return_url', label: 'Return URL' },
  { key: 'cancel_url', label: 'Cancel URL' },
  { key: 'checkout_url', label: 'Checkout URL' },
];

/**
 * Online payments with PayHere (docs/api/payhere.md §5; `GET|PATCH
 * /admin/settings/payment-gateway`). Operations switches it on/off and sets
 * the payment window and the accepted-methods note; mode, merchant ID and
 * merchant secret are Admin-only - the server's `can_edit_credentials` says
 * which this account is. The secret is write-only: it is never shown (the
 * API never returns it), only sent when typed, and cleared after a save.
 * Same setting as Admin > Settings.
 */
export function PaymentGatewayCard() {
  const [current, setCurrent] = useState<PaymentGatewaySetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState('20');
  const [methods, setMethods] = useState('');
  const [mode, setMode] = useState<Mode>('sandbox');
  const [merchantId, setMerchantId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState<PaymentGatewayTestHash | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  function show(s: PaymentGatewaySetting) {
    setCurrent(s);
    setEnabled(s.enabled);
    setWindowMinutes(String(s.payment_window_minutes));
    setMethods(s.allowed_methods ?? '');
    setMode(s.mode);
    setMerchantId(s.merchant_id ?? '');
    setSecret('');
  }

  useEffect(() => {
    settings.paymentGateway
      .get()
      .then(show)
      .catch((err) => setLoadError(paymentGatewayErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setNotice(null);
    const minutes = parseWindowMinutes(windowMinutes);
    if ('error' in minutes) {
      setError(minutes.error);
      return;
    }
    const trimmedId = merchantId.trim();
    if (current.can_edit_credentials && trimmedId !== (current.merchant_id ?? '') && !/^\d{1,32}$/.test(trimmedId)) {
      setError('The merchant ID is digits only (up to 32).');
      return;
    }
    if (current.can_edit_credentials && secret !== '' && (secret.length < 8 || secret.length > 128)) {
      setError('The merchant secret is 8 to 128 characters.');
      return;
    }
    const body: PaymentGatewayInput = {
      enabled,
      payment_window_minutes: minutes.value,
      allowed_methods: methods.trim() === '' ? null : methods.trim(),
    };
    // Credentials only from an Admin, and only what changed; the secret only when typed.
    if (current.can_edit_credentials) {
      if (mode !== current.mode) body.mode = mode;
      if (trimmedId !== (current.merchant_id ?? '')) body.merchant_id = trimmedId;
      if (secret !== '') body.merchant_secret = secret;
    }
    setError(null);
    setSaving(true);
    try {
      show(await settings.paymentGateway.update(body));
      setNotice('Online payment settings saved.');
    } catch (err) {
      setError(paymentGatewayErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function generateSample() {
    setSampleError(null);
    setSample(null);
    setSampleBusy(true);
    try {
      setSample(await settings.paymentGateway.testHash());
    } catch (err) {
      setSampleError(paymentGatewayErrorMessage(err));
    } finally {
      setSampleBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError('Could not copy. Select the address and copy it.');
    }
  }

  return (
    <section className="card payment-gateway" aria-labelledby="payment-gateway-title">
      <h2 className="section-label" id="payment-gateway-title">
        Online payments (PayHere)
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading online payment settings" />
      ) : (
        <>
          <p className="payment-gateway__status" data-testid="payment-gateway-status">
            <Status tone={current.ready ? 'ok' : 'warn'}>{current.ready ? 'Ready' : 'Not configured'}</Status>
            <Status tone={current.mode === 'live' ? 'info' : 'muted'}>{MODE_TEXT[current.mode]}</Status>
            <Status tone={current.enabled ? 'ok' : 'muted'}>{current.enabled ? 'On' : 'Off'}</Status>
          </p>
          {!current.encryption_key_configured ? (
            <p className="field__error" role="alert" data-testid="payment-key-missing">
              The server has no PAYMENT_SECRET_KEY, so the merchant secret can't be saved or used. Ask whoever runs the
              server to set it.
            </p>
          ) : null}
          <p className="quiet">
            Cash on delivery stays the default. Customers see "Pay online" only while this is on and PayHere is fully set
            up. Unpaid online orders wait as "Awaiting payment" and are never packed.
          </p>

          <form className="form" onSubmit={save} noValidate>
            <div className="payment-gateway__switch">
              <span>
                <strong>Online payments</strong>
                <em className="quiet"> Customers can pay by card or wallet through PayHere.</em>
              </span>
              <Switch label="Online payments" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
            </div>
            <label className="field">
              <span className="field__label">Payment window (minutes)</span>
              <input
                className="input"
                inputMode="numeric"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(e.target.value)}
              />
            </label>
            <p className="quiet">An unpaid online order is cancelled after this long (5 to 180 minutes).</p>
            <label className="field">
              <span className="field__label">Accepted methods note</span>
              <input
                className="input"
                maxLength={200}
                value={methods}
                placeholder="Visa, Mastercard, eZ Cash"
                onChange={(e) => setMethods(e.target.value)}
              />
            </label>

            <fieldset className="payment-gateway__credentials">
              <legend className="field__label">PayHere credentials</legend>
              {current.can_edit_credentials ? (
                <>
                  <label className="field">
                    <span className="field__label">Mode</span>
                    <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                      <option value="sandbox">Sandbox (test payments)</option>
                      <option value="live">Live (real money)</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Merchant ID</span>
                    <input
                      className="input mono"
                      inputMode="numeric"
                      value={merchantId}
                      onChange={(e) => setMerchantId(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">New merchant secret</span>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={secret}
                      placeholder={current.merchant_secret_set ? 'Leave empty to keep the saved secret' : 'Paste the merchant secret'}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <p className="payment-gateway__readonly">
                    Mode: <strong>{MODE_TEXT[current.mode]}</strong>
                  </p>
                  <p className="payment-gateway__readonly">
                    Merchant ID: <strong className="mono">{current.merchant_id || 'Not saved'}</strong>
                  </p>
                  <p className="quiet" data-testid="credentials-admin-only">
                    Only an Admin can change PayHere credentials
                  </p>
                </>
              )}
              <p className="quiet" data-testid="merchant-secret-status">
                {current.merchant_secret_set
                  ? `Merchant secret: ${current.merchant_secret_masked || '••••'} saved${
                      current.merchant_secret_updated_at ? `, last updated ${formatDateTime(current.merchant_secret_updated_at)}` : ''
                    }`
                  : 'Merchant secret: not saved'}
              </p>
            </fieldset>

            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </form>

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="quiet quiet--ok" role="status">
              {notice}
            </p>
          ) : null}

          <div className="payment-gateway__urls" role="group" aria-label="PayHere addresses">
            <p className="field__label">Addresses for the PayHere merchant portal</p>
            {URL_ROWS.map(({ key, label }) => (
              <div key={key} className="payment-gateway__url">
                <label className="field">
                  <span className="field__label">{label}</span>
                  <input className="input mono" readOnly value={current[key]} onFocus={(e) => e.currentTarget.select()} />
                </label>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Copy ${label}`}
                  onClick={() => void copy(label, current[key])}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>

          <div className="payment-gateway__sample">
            <button type="button" className="button button--ghost" disabled={sampleBusy} onClick={() => void generateSample()}>
              {sampleBusy ? 'Generating…' : 'Generate sample hash'}
            </button>
            <p className="quiet">Checks the saved secret works. No call is made to PayHere.</p>
            {sampleError ? (
              <p className="field__error" role="alert">
                {sampleError}
              </p>
            ) : null}
            {sample ? (
              <dl className="payment-gateway__hash" data-testid="sample-hash">
                <dt>Order ID</dt>
                <dd className="mono">{sample.order_id}</dd>
                <dt>Amount</dt>
                <dd className="mono">{sample.amount}</dd>
                <dt>Currency</dt>
                <dd className="mono">{sample.currency}</dd>
                <dt>Hash</dt>
                <dd className="mono">{sample.hash}</dd>
              </dl>
            ) : null}
          </div>

          {current.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
        </>
      )}
    </section>
  );
}
