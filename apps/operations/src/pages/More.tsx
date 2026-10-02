import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { settings } from '../api/resources';
import type { DeliveryFeeSetting } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { catalogErrorMessage, parseDeliveryFee } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';

/**
 * The More tab (plan §8: rider list, settings, sign-out). Sign-out is real,
 * working functionality. Task F7 replaces the "rider list ... built by a
 * later task" placeholder line with a real entry point to the new
 * `/more/riders` read-only roster (plan §14, common.md rule 9) - a link, not
 * a fabricated action, since the screen it leads to is itself read-only (no
 * rider create/activate/deactivate/edit capability exists in the backend).
 * The "Delivery fee" setting (store-wide, `GET|PATCH
 * /admin/settings/delivery-fee`) lives here as the app's settings area.
 */
export function More() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <PageHeader title="More" description="Riders, rider cash, settings, account and sign-out." />
      <section className="card">
        <p className="card__row">
          <span className="card__label">Signed in as</span>
          <span className="card__value">{user?.full_name ?? user?.phone}</span>
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
          <Link className="cat-hub__card" to="/more/staff">
            <span className="cat-hub__title">Staff accounts</span>
          </Link>
        </li>
      </ul>

      <DeliveryFeeCard />

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
