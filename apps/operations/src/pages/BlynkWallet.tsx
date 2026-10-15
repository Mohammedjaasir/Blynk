import { useEffect, useState, type FormEvent } from 'react';
import { wallet as walletApi, type WalletSetting } from '../api/wallet';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { formatDateTime } from '../lib/inventory';
import { changedFields } from '../lib/referralPoints';
import { expiryText, readWalletForm, walletErrorMessage, walletFormFrom, type WalletForm, type WalletFormField } from '../lib/wallet';

/**
 * More -> Blynk Wallet (owner, 2026-10-15; docs/api/wallet.md). Every
 * approved refund goes to the customer's wallet, and the balance pays for
 * their next orders. Admin has the same controls under Settings; refunds are
 * given from an order, and a customer's balance is under Customer addresses.
 */
export function BlynkWallet() {
  return (
    <div className="page">
      <PageHeader
        title="Blynk Wallet"
        description="Refunds go to the customer's Blynk Wallet and pay for their next orders. It is never paid out as cash."
      />
      <WalletSettingsCard />
    </div>
  );
}

const FIELDS: { field: WalletFormField; label: string; hint: string }[] = [
  {
    field: 'expiry_months',
    label: 'Credits expire after (months)',
    hint: '0 = never. Whole months, up to 120. Applies to credits added from now on; the soonest-expiring credits are used first.',
  },
  {
    field: 'max_use_percent',
    label: 'Most of an order the wallet can pay (%)',
    hint: 'Whole %, 1 to 100, of what is due after points, including the delivery fee.',
  },
];

export function WalletSettingsCard() {
  const [current, setCurrent] = useState<WalletSetting | null>(null);
  const [form, setForm] = useState<WalletForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field?: WalletFormField } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: WalletSetting) {
    setCurrent(s);
    setForm(walletFormFrom(s));
  }

  useEffect(() => {
    walletApi
      .getSetting()
      .then(show)
      .catch((err) => setLoadError(walletErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || !form) return;
    setNotice(null);
    const read = readWalletForm(form);
    if ('error' in read) {
      setError({ message: read.error, field: read.field });
      return;
    }
    // updated_at is copied over so it never counts as a change.
    const body = changedFields(current, { ...read.value, updated_at: current.updated_at });
    setError(null);
    if (Object.keys(body).length === 0) {
      setNotice('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await walletApi.setSetting(body));
      setNotice('Blynk Wallet saved.');
    } catch (err) {
      setError({ message: walletErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const preview = form ? readWalletForm(form) : null;

  return (
    <section className="card" aria-labelledby="wallet-settings-title">
      <h2 className="section-label" id="wallet-settings-title">
        Blynk Wallet
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current || !form ? (
        <Spinner label="Loading Blynk Wallet" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              <strong>Use wallet balance at checkout</strong>
              <em>Off hides "Use wallet balance" at checkout. Refunds are still added and customers still see their balance.</em>
            </span>
          </label>
          {FIELDS.map(({ field, label, hint }) => (
            <label key={field} className="field">
              <span className="field__label">{label}</span>
              <input
                className="input"
                inputMode="numeric"
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                aria-invalid={error?.field === field ? true : undefined}
              />
              <span className="field__hint">{hint}</span>
            </label>
          ))}
          {preview && 'value' in preview ? (
            <p className="quiet" data-testid="wallet-expiry">
              {expiryText(preview.value.expiry_months)}
            </p>
          ) : null}
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error.message}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
