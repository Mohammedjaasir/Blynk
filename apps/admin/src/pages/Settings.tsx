import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import type { DeliveryFeeSetting } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Field, Spinner, useToast } from '../components/ui';
import { parseDeliveryFee } from '../lib/deliveryFee';
import { formatMoney } from '../lib/orders';

/**
 * Store settings. Today that is the delivery fee the customer app charges
 * on new orders (GET/PATCH /admin/settings/delivery-fee).
 */
export function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Store-wide values the customer app uses." />
      <DeliveryFeeSettingPanel />
    </>
  );
}

function DeliveryFeeSettingPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<DeliveryFeeSetting | null>(null);
  const [value, setValue] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getDeliveryFee()
      .then((setting) => {
        if (cancelled) return;
        setCurrent(setting);
        setValue(String(setting.fee_lkr));
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load the delivery fee.'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDeliveryFee(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.setDeliveryFee(parsed.fee);
      setCurrent(updated);
      setValue(String(updated.fee_lkr));
      toast.success(`Delivery fee is now ${formatMoney(updated.fee_lkr)}.`);
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setError(detail ?? (err instanceof Error ? err.message : 'Could not save the delivery fee.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Delivery fee">
      <h2 className="panel__title">Delivery fee</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the delivery fee" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            Currently {formatMoney(current.fee_lkr)} per order
            {current.updated_at ? ` (changed ${new Date(current.updated_at).toLocaleString()})` : ''}.
          </p>
          <Field label="Delivery fee (LKR)" hint="Between 0 and 1,000, up to 2 decimals." error={error ?? undefined}>
            <input
              className="input"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <p className="form__note">Orders already placed keep the fee they were placed with.</p>
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
