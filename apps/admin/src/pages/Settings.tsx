import { errorMessage } from '../lib/apiErrors';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import type { CheckoutSettings, DeliveryFeeSetting } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, Field, Spinner, useToast } from '../components/ui';
import { formatDay } from '../lib/coupons';
import { parseDeliveryFee, parseFreeDeliveryCount } from '../lib/deliveryFee';
import { formatMoney } from '../lib/orders';

/**
 * Store settings: the delivery fee the customer app charges on new orders
 * (GET/PATCH /admin/settings/delivery-fee) and the checkout switches - coupon
 * codes and free deliveries for every customer (GET/PATCH
 * /admin/settings/checkout; owner, 2026-10-08, every customer since a start
 * date: owner, 2026-10-09).
 */
export function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Store-wide values the customer app uses." />
      <DeliveryFeeSettingPanel />
      <CheckoutSettingsPanel />
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
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the delivery fee.')));
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
      setError(detail ?? errorMessage(err, 'Could not save the delivery fee.'));
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

function CheckoutSettingsPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<CheckoutSettings | null>(null);
  const [coupons, setCoupons] = useState(false);
  const [freeOn, setFreeOn] = useState(true);
  const [count, setCount] = useState('2');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  function show(setting: CheckoutSettings) {
    setCurrent(setting);
    setCoupons(setting.coupons_enabled);
    setFreeOn(setting.new_customer_free_deliveries.enabled);
    setCount(String(setting.new_customer_free_deliveries.count));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getCheckout()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the checkout settings.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parseFreeDeliveryCount(count);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.setCheckout({
        coupons_enabled: coupons,
        new_customer_free_deliveries: { enabled: freeOn, count: parsed.count },
      });
      show(updated);
      toast.success('Checkout settings saved.');
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setError(detail ?? errorMessage(err, 'Could not save the checkout settings.'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Every customer gets the free deliveries again, counting orders from now
   * (owner, 2026-10-09). Uses the stored on/off and count, not unsaved edits.
   */
  async function restartFromToday() {
    if (!current) return;
    setConfirmRestart(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.setCheckout({
        new_customer_free_deliveries: {
          enabled: current.new_customer_free_deliveries.enabled,
          count: current.new_customer_free_deliveries.count,
          since: new Date().toISOString(),
        },
      });
      show(updated);
      toast.success('Free deliveries now count orders from today.');
    } catch (err) {
      setError(errorMessage(err, 'Could not restart the free deliveries.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Checkout">
      <h2 className="panel__title">Checkout</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the checkout settings" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={coupons} onChange={(e) => setCoupons(e.target.checked)} />
            <span>Coupon codes at checkout</span>
          </label>
          <p className="form__note">When off, the app hides the coupon field and orders ignore any code.</p>
          <label className="toggle">
            <input type="checkbox" checked={freeOn} onChange={(e) => setFreeOn(e.target.checked)} />
            <span>Free deliveries for every customer</span>
          </label>
          <Field label="Free deliveries per customer" hint="0 to 10. Cancelled orders do not use one up." error={error ?? undefined}>
            <input
              className="input"
              inputMode="numeric"
              value={count}
              disabled={!freeOn}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          {Number.isFinite(Date.parse(current.new_customer_free_deliveries.since ?? '')) ? (
            <p className="form__note">
              Counting orders since {formatDay(current.new_customer_free_deliveries.since)}. Orders placed before then do not
              use one up.
            </p>
          ) : null}
          <p className="form__note">Changes apply to orders placed from now on.</p>
          <div className="form__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={saving}
              onClick={() => setConfirmRestart(true)}
            >
              Start again from today
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
      {confirmRestart && current ? (
        <ConfirmDialog
          title="Start free deliveries again"
          message={`Every customer gets ${current.new_customer_free_deliveries.count} free ${
            current.new_customer_free_deliveries.count === 1 ? 'delivery' : 'deliveries'
          } again, counting orders from today. Orders placed before today will not use them up.`}
          confirmLabel="Start again"
          onConfirm={() => void restartFromToday()}
          onCancel={() => setConfirmRestart(false)}
        />
      ) : null}
    </section>
  );
}
