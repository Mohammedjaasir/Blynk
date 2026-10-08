import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { riderApplications, settings } from '../api/resources';
import type { CheckoutSettings, DeliveryFeeSetting } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { catalogErrorMessage, parseDeliveryFee, parseFreeDeliveryCount } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';

/**
 * The More tab (plan §8: rider list, settings, sign-out). Sign-out is real,
 * working functionality. Task F7 replaces the "rider list ... built by a
 * later task" placeholder line with a real entry point to the new
 * `/more/riders` read-only roster (plan §14, common.md rule 9) - a link, not
 * a fabricated action, since the screen it leads to is itself read-only (no
 * rider create/activate/deactivate/edit capability exists in the backend).
 * The "Delivery fee" setting (store-wide, `GET|PATCH
 * /admin/settings/delivery-fee`) lives here as the app's settings area, with
 * the checkout switches (`GET|PATCH /admin/settings/checkout`; owner,
 * 2026-10-08): coupon codes on/off and free deliveries for new customers.
 */
export function More() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [pendingRiders, setPendingRiders] = useState(0);

  useEffect(() => {
    let live = true;
    riderApplications
      .pendingCount()
      .then((n) => live && setPendingRiders(n))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <PageHeader title="More" description="Riders, rider requests, rider cash, staff, SMS offers, settings and sign-out." />
      <section className="card">
        <p className="card__row">
          <span className="card__label">Signed in as</span>
          <span className="card__value">{user?.full_name ?? user?.phone ?? user?.email}</span>
        </p>
        <p className="card__row">
          <span className="card__label">Role</span>
          <span className="card__value">{user?.role}</span>
        </p>
      </section>

      <ul className="cat-hub">
        <li>
          <Link className="cat-hub__card" to="/more/riders">
            <span className="cat-hub__title">Riders</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/more/cash">
            <span className="cat-hub__title">Cash</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/more/deliver">
            <span className="cat-hub__title">Deliver orders myself</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/more/rider-requests">
            <span className="cat-hub__title">Rider requests</span>
            {pendingRiders > 0 ? (
              <span className="cat-hub__count" aria-label={`${pendingRiders} waiting`}>
                {pendingRiders}
              </span>
            ) : null}
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/more/staff">
            <span className="cat-hub__title">Staff accounts</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/more/sms-offers">
            <span className="cat-hub__title">SMS offers</span>
          </Link>
        </li>
      </ul>

      <DeliveryFeeCard />
      <CheckoutSettingsCard />

      <section className="card">
        <button type="button" className="button button--ghost" onClick={() => void handleSignOut()}>
          Sign out
        </button>
      </section>
    </div>
  );
}

/** Store-wide delivery fee. New orders use the saved value; placed orders
 * keep theirs (the server snapshots it on each order). */
function DeliveryFeeCard() {
  const [current, setCurrent] = useState<DeliveryFeeSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settings.deliveryFee
      .get()
      .then((fee) => {
        setCurrent(fee);
        setValue(String(fee.fee_lkr));
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseDeliveryFee(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.deliveryFee.update(parsed.value);
      setCurrent(saved);
      setValue(String(saved.fee_lkr));
      setNotice(`Delivery fee saved: LKR ${Number(saved.fee_lkr).toFixed(2)}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="delivery-fee-title">
      <h2 className="section-label" id="delivery-fee-title">
        Delivery fee
      </h2>
      {current ? (
        <p className="card__row">
          <span className="card__label">Current fee</span>
          <span className="card__value mono">LKR {Number(current.fee_lkr).toFixed(2)}</span>
        </p>
      ) : loadError ? (
        <p className="field__error">{loadError}</p>
      ) : (
        <Spinner label="Loading delivery fee" />
      )}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <form className="fee-form" onSubmit={save} noValidate>
        <label className="field">
          <span className="field__label">New fee (LKR)</span>
          <input
            className="input"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            disabled={!current && !loadError}
          />
        </label>
        <button type="submit" className="button" disabled={saving || (!current && !loadError)}>
          {saving ? <Spinner label="Saving" /> : 'Save'}
        </button>
      </form>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      <p className="page__note">Orders already placed keep the fee they were placed with.</p>
    </section>
  );
}

/** Coupon codes at checkout, and free deliveries for new customers. New
 * orders follow the saved switches; placed orders keep their fee. */
function CheckoutSettingsCard() {
  const [current, setCurrent] = useState<CheckoutSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coupons, setCoupons] = useState(false);
  const [freeOn, setFreeOn] = useState(true);
  const [count, setCount] = useState('2');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: CheckoutSettings) {
    setCurrent(s);
    setCoupons(s.coupons_enabled);
    setFreeOn(s.new_customer_free_deliveries.enabled);
    setCount(String(s.new_customer_free_deliveries.count));
  }

  useEffect(() => {
    settings.checkout
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseFreeDeliveryCount(count);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      show(
        await settings.checkout.update({
          coupons_enabled: coupons,
          new_customer_free_deliveries: { enabled: freeOn, count: parsed.value },
        })
      );
      setNotice('Checkout settings saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="checkout-settings-title">
      <h2 className="section-label" id="checkout-settings-title">
        Checkout
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading checkout settings" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={coupons} onChange={(e) => setCoupons(e.target.checked)} />
            <span>
              <strong>Coupon codes at checkout</strong>
              <em>When off, the app hides the coupon field.</em>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={freeOn} onChange={(e) => setFreeOn(e.target.checked)} />
            <span>
              <strong>Free deliveries for new customers</strong>
              <em>Cancelled orders do not use one up.</em>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Free deliveries per new customer</span>
            <input
              className="input"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-invalid={error ? true : undefined}
              disabled={!freeOn}
            />
          </label>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
