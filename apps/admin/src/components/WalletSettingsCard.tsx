import { useEffect, useState, type FormEvent } from 'react';
import { wallet, type WalletSetting } from '../api/wallet';
import { errorMessage } from '../lib/apiErrors';
import { changedFields } from '../lib/referralPoints';
import { WALLET_SETTINGS_NOTE, readWalletForm, walletExpiryText, walletFormFrom, type WalletForm, type WalletFormField } from '../lib/wallet';
import { Field, Spinner, useToast } from './ui';

const FIELDS: { field: WalletFormField; label: string; hint: string }[] = [
  {
    field: 'expiry_months',
    label: 'Wallet credits expire after (months)',
    hint: '0 = never. Whole months, up to 120. Applies to credits added after you save.',
  },
  {
    field: 'max_use_percent',
    label: 'Most of an order the wallet can pay (%)',
    hint: 'Of what is due after points, delivery fee included. Whole number, 1 to 100.',
  },
];

/**
 * Settings -> Blynk Wallet (owner, 2026-10-15; docs/api/wallet.md): on/off,
 * expiry and how much of an order the balance may pay. PATCH sends only what
 * changed.
 */
export function WalletSettingsCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<WalletSetting | null>(null);
  const [form, setForm] = useState<WalletForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: WalletFormField; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: WalletSetting) {
    setCurrent(s);
    setForm(walletFormFrom(s));
  }

  useEffect(() => {
    let cancelled = false;
    wallet
      .getSetting()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load Blynk Wallet.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || !form) return;
    setSaveError(null);
    const read = readWalletForm(form);
    if ('error' in read) {
      setFieldError({ field: read.field, message: read.error });
      return;
    }
    setFieldError(null);
    const body = changedFields(current, { ...read.value, updated_at: current.updated_at });
    if (Object.keys(body).length === 0) {
      toast.success('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await wallet.setSetting(body));
      toast.success('Blynk Wallet saved.');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save Blynk Wallet.'));
    } finally {
      setSaving(false);
    }
  }

  const preview = form ? readWalletForm(form) : null;

  return (
    <section className="panel" id="wallet" aria-label="Blynk Wallet">
      <h2 className="panel__title">Blynk Wallet</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current || !form ? (
        <Spinner label="Loading Blynk Wallet" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              Blynk Wallet at checkout
              <em>Customers can pay part or all of an order from their wallet. {WALLET_SETTINGS_NOTE}</em>
            </span>
          </label>
          <ul className="form__note" aria-label="How the wallet works">
            <li>Every approved refund goes to the customer's wallet, whatever they paid with.</li>
            <li>The balance pays for Blynk orders only - it is never paid out as cash or moved to another account.</li>
            <li>At checkout the wallet is used after coupons, birthday gifts, referral rewards and Blynk Points.</li>
          </ul>
          {FIELDS.map(({ field, label, hint }) => (
            <Field key={field} label={label} hint={hint} error={fieldError?.field === field ? fieldError.message : undefined}>
              <input className="input" inputMode="numeric" value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
            </Field>
          ))}
          {preview && 'value' in preview ? (
            <p className="form__note" data-testid="wallet-expiry">
              {walletExpiryText(preview.value.expiry_months)}
            </p>
          ) : null}
          {current.updated_at ? <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p> : null}
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
