import { errorMessage } from '../lib/apiErrors';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import type { BirthdayOfferSetting, CheckoutSettings, DeliveryFeeSetting, RiderCommissionSetting } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, Field, Spinner, useToast } from '../components/ui';
import { MAX_BIRTHDAY_SMS, fillPercent, parseBirthdayPercent, percentText } from '../lib/birthday';
import { formatDay } from '../lib/coupons';
import { parseDeliveryFee, parseFreeDeliveryCount } from '../lib/deliveryFee';
import { formatMoney } from '../lib/orders';
import { formatPercent, parsePercent } from '../lib/riderPay';
import { partsLabel, smsParts } from '../lib/smsOffers';

/**
 * Store settings: the delivery fee the customer app charges on new orders
 * (GET/PATCH /admin/settings/delivery-fee) and the checkout switches - coupon
 * codes and free deliveries for every customer (GET/PATCH
 * /admin/settings/checkout; owner, 2026-10-08, every customer since a start
 * date: owner, 2026-10-09), and the default commission % commission riders
 * earn of the standard delivery fee (GET/PATCH
 * /admin/settings/rider-commission; owner, 2026-10-09), and the birthday
 * offer - % off one order in the customer's birthday week plus a birthday SMS
 * (GET/PATCH /admin/settings/birthday-offer; owner, 2026-10-09).
 */
export function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Store-wide values the customer app uses." />
      <DeliveryFeeSettingPanel />
      <CheckoutSettingsPanel />
      <RiderCommissionPanel />
      <BirthdayOfferPanel />
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

/**
 * Commission riders earn this % of the STANDARD delivery fee on each delivery
 * unless they have their own % (owner, 2026-10-09). Company riders are
 * salaried and earn no commission.
 */
function RiderCommissionPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<RiderCommissionSetting | null>(null);
  const [value, setValue] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getRiderCommission()
      .then((setting) => {
        if (cancelled) return;
        setCurrent(setting);
        setValue(formatPercent(setting.default_percent));
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the rider commission.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parsePercent(value);
    if ('error' in parsed || parsed.percent === null) {
      setError('error' in parsed ? parsed.error : 'Enter a percentage from 0 to 100.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.setRiderCommission(parsed.percent);
      setCurrent(updated);
      setValue(formatPercent(updated.default_percent));
      toast.success(`Commission riders now earn ${formatPercent(updated.default_percent)}% of the delivery fee.`);
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setError(detail ?? errorMessage(err, 'Could not save the rider commission.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Rider commission">
      <h2 className="panel__title">Rider commission</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the rider commission" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            Commission riders currently earn {formatPercent(current.default_percent)}% of the standard delivery fee
            {current.updated_at ? ` (changed ${new Date(current.updated_at).toLocaleString()})` : ''}.
          </p>
          <Field label="Default commission (%)" hint="0 to 100, up to 2 decimals." error={error ?? undefined}>
            <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <p className="form__note">
            A commission rider keeps this share out of the cash they collect and hands in the rest. Riders with their own %
            keep it; company riders earn no commission. Past deliveries keep what they earned. Change a rider's type under Rider earnings.
          </p>
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

/**
 * X% off ONE order in the customer's birthday week (birthday +-3 days,
 * Colombo time) and a birthday SMS on the day (owner, 2026-10-09). The gift
 * never stacks with a coupon - the server uses the larger discount.
 */
function BirthdayOfferPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<BirthdayOfferSetting | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [percent, setPercent] = useState('10');
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [smsText, setSmsText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(setting: BirthdayOfferSetting) {
    setCurrent(setting);
    setEnabled(setting.enabled);
    setPercent(percentText(setting.percent));
    setSmsEnabled(setting.sms_enabled);
    setSmsText(setting.sms_text);
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getBirthdayOffer()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the birthday offer.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parseBirthdayPercent(percent);
    setSmsError(null);
    setSaveError(null);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const text = smsText.trim();
    if (!text) {
      setSmsError('Write the birthday SMS.');
      return;
    }
    if (text.length > MAX_BIRTHDAY_SMS) {
      setSmsError(`The SMS can be at most ${MAX_BIRTHDAY_SMS} characters.`);
      return;
    }
    setSaving(true);
    try {
      show(await settingsApi.setBirthdayOffer({ enabled, percent: parsed.value, sms_enabled: smsEnabled, sms_text: text }));
      toast.success('Birthday offer saved.');
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setSaveError(detail ?? errorMessage(err, 'Could not save the birthday offer.'));
    } finally {
      setSaving(false);
    }
  }

  // While typing, {percent} is filled locally; once saved (nothing changed
  // since), the preview and part count are the server's own.
  const parsedPercent = parseBirthdayPercent(percent);
  const shownPercent = 'value' in parsedPercent ? percentText(parsedPercent.value) : current ? percentText(current.percent) : '';
  const unchanged =
    !!current && smsText.trim() === current.sms_text.trim() && 'value' in parsedPercent && parsedPercent.value === current.percent;
  const preview = unchanged && current ? current.sms_preview : fillPercent(smsText, shownPercent);
  const parts = unchanged && current ? current.sms_parts : preview ? smsParts(preview) : 0;

  return (
    <section className="panel" aria-label="Birthday offer">
      <h2 className="panel__title">Birthday offer</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the birthday offer" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              Birthday offer
              <em>
                % off one order in the customer&apos;s birthday week ({current.window_days} days either side). Not with a coupon -
                the bigger discount wins.
              </em>
            </span>
          </label>
          <Field label="Birthday discount (%)" hint="Off the items, not the delivery fee. More than 0, up to 50." error={error ?? undefined}>
            <input className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
          <label className="toggle">
            <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} />
            <span>
              Birthday SMS
              <em>
                Sent on the birthday from 8 AM, once a year, only while the offer is on and the customer gets offers by SMS.
              </em>
            </span>
          </label>
          <Field label="Birthday SMS text" error={smsError ?? undefined}>
            <textarea
              className="input"
              rows={3}
              maxLength={MAX_BIRTHDAY_SMS}
              value={smsText}
              disabled={!smsEnabled}
              onChange={(e) => setSmsText(e.target.value)}
            />
          </Field>
          <p className="form__note" data-testid="birthday-sms-count">
            {smsText.length} / {MAX_BIRTHDAY_SMS} characters{preview ? ` · ${partsLabel(parts)}` : ''} · {'{percent}'} becomes the %
          </p>
          {preview ? (
            <div className="preview">
              <p className="preview__label">Customers receive</p>
              <p className="sms-offers__preview" aria-label="Birthday SMS preview">
                {preview}
              </p>
            </div>
          ) : null}
          {current.updated_at ? (
            <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p>
          ) : null}
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
