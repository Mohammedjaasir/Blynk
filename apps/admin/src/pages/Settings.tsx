import { errorMessage } from '../lib/apiErrors';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import { useLocation } from 'react-router-dom';
import type {
  BirthdayOfferSetting,
  CheckoutSettings,
  DeliveryFeeInput,
  DeliveryFeeMode,
  DeliveryFeeSetting,
  RiderCommissionSetting,
  RiderTripsSetting,
} from '../api/types';
import { KmTierEditor, ModeChoice } from '../components/KmTierEditor';
import { PageHeader } from '../components/Layout';
import { StoreScheduleSettings } from '../components/StoreSchedulePanels';
import { ReferralSettingsCard } from '../components/ReferralSettingsCard';
import { PointsSettingsCard } from '../components/PointsSettingsCard';
import { RiderDocumentsSettingsCard } from '../components/RiderDocumentsSettingsCard';
import { RiderPaySettings } from '../components/RiderPaySettings';
import { ConfirmDialog, Field, Spinner, useToast } from '../components/ui';
import { MAX_BIRTHDAY_SMS, fillPercent, parseBirthdayPercent, percentText } from '../lib/birthday';
import { formatDay } from '../lib/coupons';
import { parseDeliveryFee, parseFreeDeliveryCount } from '../lib/deliveryFee';
import { parseFeeCap, parseTierDrafts, tiersSummary, tiersToDrafts, type TierErrors } from '../lib/kmTiers';
import { formatMoney } from '../lib/orders';
import { formatPercent, parsePercent } from '../lib/riderPay';
import { MAX_DROPOFF_KM, MIN_DROPOFF_KM, TRIP_ORDER_CHOICES, formatKm, parseDropoffKm, tripOrdersLabel } from '../lib/riderTrips';
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
 * (GET/PATCH /admin/settings/birthday-offer; owner, 2026-10-09), and rider
 * trips - how many orders one rider may carry at once and how far apart their
 * drop-offs may be (GET/PATCH /admin/settings/rider-trips; owner, 2026-10-10).
 * /settings#checkout (the Coupons page's link) scrolls to Checkout. The
 * store schedule - store status with close-now, opening hours, holidays and
 * delivery slots - comes first (owner, 2026-10-10).
 */
export function Settings() {
  const { hash } = useLocation();

  // /settings#checkout (owner, 2026-10-10): the Coupons page links here when
  // coupon codes are off. The panel loads after a moment, so retry briefly.
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(hash.slice(1));
      if (el || ++tries > 20) window.clearInterval(timer);
      el?.scrollIntoView?.({ block: 'start' });
    }, 100);
    return () => window.clearInterval(timer);
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" description="Store-wide values the customer app uses." />
      <StoreScheduleSettings />
      <DeliveryFeeSettingPanel />
      <CheckoutSettingsPanel />
      {/* Rider pay (owner, 2026-10-10): default pay model, bonuses and the rain
          boost. Its % is the default commission, so the old commission card
          only shows against an API without the pay controls. */}
      <RiderPaySettings fallback={<RiderCommissionPanel />} />
      <RiderTripsPanel />
      {/* Rider documents riders upload at sign-up (owner, 2026-10-10). */}
      <RiderDocumentsSettingsCard />
      <BirthdayOfferPanel />
      {/* Refer a friend and Blynk Points (owner, 2026-10-10). */}
      <ReferralSettingsCard />
      <PointsSettingsCard />
    </>
  );
}

/**
 * Rider trips (owner, 2026-10-10: "ops can control the 2 orders for one
 * delivery if it's in the same route"). Assigning a rider follows these: at
 * most this many open orders per rider, and a second drop-off farther than
 * the distance from one they already hold needs staff to confirm.
 */
function RiderTripsPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<RiderTripsSetting | null>(null);
  const [orders, setOrders] = useState<number | null>(null);
  const [km, setKm] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(setting: RiderTripsSetting) {
    setCurrent(setting);
    setOrders(setting.max_active_deliveries);
    setKm(String(Number(setting.max_dropoff_distance_km.toFixed(1))));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getRiderTrips()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the rider trips.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (orders === null || !(TRIP_ORDER_CHOICES as readonly number[]).includes(orders)) {
      setError('Pick how many orders one rider can carry.');
      return;
    }
    const parsed = parseDropoffKm(km);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.setRiderTrips({ max_active_deliveries: orders, max_dropoff_distance_km: parsed.value });
      show(updated);
      toast.success(`Rider trips: ${tripOrdersLabel(updated.max_active_deliveries)}, ${formatKm(updated.max_dropoff_distance_km)}.`);
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setError(detail ?? errorMessage(err, 'Could not save the rider trips.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Rider trips">
      <h2 className="panel__title">Rider trips</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the rider trips" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            Now {tripOrdersLabel(current.max_active_deliveries)}, {formatKm(current.max_dropoff_distance_km)}
            {current.updated_at ? ` (changed ${new Date(current.updated_at).toLocaleString()})` : ''}.
          </p>
          <div className="field">
            <span className="field__label" id="trip-orders-label">
              Orders one rider can carry at once
            </span>
            <div className="segmented" role="group" aria-labelledby="trip-orders-label">
              {TRIP_ORDER_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === orders ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={n === orders}
                  aria-label={tripOrdersLabel(n)}
                  onClick={() => setOrders(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="field__hint">1 = no trips: one order per rider.</span>
          </div>
          <Field
            label="Max distance between drop-offs (km)"
            hint={`${MIN_DROPOFF_KM} to ${MAX_DROPOFF_KM} km, straight line, up to 1 decimal.`}
            error={error ?? undefined}
          >
            <input className="input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
          </Field>
          <p className="form__note">
            A second order is refused for that rider if its drop-off is farther than this, unless staff confirm.
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

/** The fee mode picks (owner, 2026-10-10). */
const FEE_MODE_OPTIONS: { value: DeliveryFeeMode; label: string }[] = [
  { value: 'FLAT', label: 'Same fee for every order' },
  { value: 'DISTANCE_TIERS', label: 'By distance (per km)' },
];

/** "LKR 150 per order" or "by distance: km 1 LKR 100, km 2+ LKR 60, at most LKR 400". */
function feeText(setting: DeliveryFeeSetting): string {
  if (setting.fee_mode !== 'DISTANCE_TIERS') return `${formatMoney(setting.fee_lkr)} per order`;
  const cap = typeof setting.max_fee_lkr === 'number' ? `, at most ${formatMoney(setting.max_fee_lkr)}` : '';
  return `by distance: ${tiersSummary(setting.tiers ?? [])}${cap}`;
}

/**
 * Delivery fee (owner, 2026-10-10): the same fee for every order (FLAT, the
 * old single fee) or by distance - per-km tiers on the road distance from the
 * store to the delivery address, with an optional maximum. Against an API
 * from before the tiers (no fee_mode in GET) the save sends only fee_lkr.
 */
function DeliveryFeeSettingPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<DeliveryFeeSetting | null>(null);
  const [mode, setMode] = useState<DeliveryFeeMode>('FLAT');
  const [value, setValue] = useState('');
  const [tierDrafts, setTierDrafts] = useState<string[]>([]);
  const [cap, setCap] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tierErrors, setTierErrors] = useState<TierErrors | undefined>();
  const [capError, setCapError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  function show(setting: DeliveryFeeSetting) {
    setCurrent(setting);
    setMode(setting.fee_mode ?? 'FLAT');
    setValue(String(setting.fee_lkr));
    setTierDrafts(tiersToDrafts(setting.tiers));
    setCap(typeof setting.max_fee_lkr === 'number' ? String(Number(setting.max_fee_lkr.toFixed(2))) : '');
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getDeliveryFee()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the delivery fee.')));
    return () => {
      cancelled = true;
    };
  }, []);

  function pickMode(next: DeliveryFeeMode) {
    setMode(next);
    setError(null);
    // No stored tiers yet: km 1 starts at the flat fee (owner, 2026-10-10).
    if (next === 'DISTANCE_TIERS' && tierDrafts.length === 0) {
      const flat = parseDeliveryFee(value);
      setTierDrafts(['fee' in flat ? String(flat.fee) : String(current?.fee_lkr ?? '')]);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    let body: number | DeliveryFeeInput;
    if (mode === 'FLAT') {
      const parsed = parseDeliveryFee(value);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      // An API from before the tiers knows only fee_lkr.
      body = current?.fee_mode === undefined ? parsed.fee : { fee_mode: 'FLAT', fee_lkr: parsed.fee };
    } else {
      const read = parseTierDrafts(tierDrafts);
      const capRead = parseFeeCap(cap);
      setTierErrors('errors' in read ? read.errors : undefined);
      setCapError('error' in capRead ? capRead.error : undefined);
      if ('errors' in read || 'error' in capRead) return;
      body = { fee_mode: 'DISTANCE_TIERS', tiers: read.tiers, max_fee_lkr: capRead.cap };
    }
    setSaving(true);
    setError(null);
    setTierErrors(undefined);
    setCapError(undefined);
    try {
      const updated = await settingsApi.setDeliveryFee(body);
      show(updated);
      toast.success(`Delivery fee is now ${feeText(updated)}.`);
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

  const liveCap = parseFeeCap(cap);

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
            Currently {feeText(current)}
            {current.updated_at ? ` (changed ${new Date(current.updated_at).toLocaleString()})` : ''}.
          </p>
          <ModeChoice label="Customers pay" value={mode} options={FEE_MODE_OPTIONS} onChange={pickMode} />
          {mode === 'FLAT' ? (
            <Field label="Delivery fee (LKR)" hint="Between 0 and 1,000, up to 2 decimals." error={error ?? undefined}>
              <input
                className="input"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <KmTierEditor
                label="Fee for each km"
                drafts={tierDrafts}
                onChange={setTierDrafts}
                errors={tierErrors}
                capLkr={'cap' in liveCap ? liveCap.cap : null}
              />
              <Field
                label="Maximum fee (LKR, optional)"
                hint="Blank = no maximum. Up to 10,000. A longer trip never costs more than this."
                error={capError}
              >
                <input className="input rp-num" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
              </Field>
              <p className="form__note">
                Distance is the road distance from the store to the delivery address. Free deliveries still cost the
                customer nothing.
              </p>
              {error ? <p className="field__error">{error}</p> : null}
            </>
          )}
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
  const [savings, setSavings] = useState(false);
  const [freeOn, setFreeOn] = useState(true);
  const [count, setCount] = useState('2');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  function show(setting: CheckoutSettings) {
    setCurrent(setting);
    setCoupons(setting.coupons_enabled);
    setSavings(setting.show_offer_savings === true);
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
        // Sent only when flipped, so saving the other switches works against
        // a backend from before this one (owner, 2026-10-10).
        ...(savings !== (current?.show_offer_savings === true) ? { show_offer_savings: savings } : {}),
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
    <section className="panel" id="checkout" aria-label="Checkout">
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
            <input type="checkbox" checked={savings} onChange={(e) => setSavings(e.target.checked)} />
            <span>Show 'Save LKR' on offers</span>
          </label>
          <p className="form__note">The customer app shows how much an offer or combo saves, e.g. "Save LKR 50".</p>
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
 * salaried and earn no commission. Since the rider pay controls (owner,
 * 2026-10-10) this card is only the fallback for an older API; the Rider pay
 * card edits the same %.
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
                Sent on the birthday from opening time, once a year, only while the offer is on and the customer gets offers by SMS.
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
