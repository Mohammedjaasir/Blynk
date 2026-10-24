import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { expiryApi, expiryErrorMessage, type ProductExpiry } from '../api/expiry';
import { batchTitle, dayText, severityClass } from '../lib/expiry';
import { Switch } from './RiderDocuments';
import './expiry.css';

/**
 * "Track expiry dates" on a product's edit form (wave 2, 2026-10-25; migration 059). The switch saves at
 * once (its own call, not part of the product save) and is a hint for staff screens; it never hides or
 * blocks a product. Lists the product's open batches. Nothing shows before migration 059 (or when the
 * section cannot load), so the product form is as it was.
 */
export function ProductExpirySection({ productId }: { productId: string }) {
  const [state, setState] = useState<ProductExpiry | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    expiryApi
      .product(productId)
      .then((s) => live && setState(s))
      .catch(() => live && setHidden(true));
    return () => {
      live = false;
    };
  }, [productId]);

  if (hidden) return null;

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await expiryApi.setTracking(productId, next));
      setNotice(next ? 'Expiry dates are tracked for this product.' : 'Expiry dates are no longer tracked for this product.');
    } catch (err) {
      setError(expiryErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form__section" aria-label="Expiry dates">
      <h2 className="form__section-title">Expiry dates</h2>
      <p className="card__row">
        <span className="card__label">Track expiry dates</span>
        <Switch label="Track expiry dates" checked={state?.expiry_tracking ?? false} disabled={!state || busy} onToggle={() => void change(!state?.expiry_tracking)} />
      </p>
      <p className="form__note">Staff note each batch's expiry date when stock arrives and see what is expiring in More, Expiry. It never hides the product.</p>
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {state && state.batches.length > 0 ? (
        <ul className="cat-list" aria-label="Open batches">
          {state.batches.map((b) => (
            <li key={b.id} className="card growth-card">
              <p className="growth-card__title">
                {b.quantity} x {batchTitle(b)}
                {b.batch_code ? ` (${b.batch_code})` : ''}
              </p>
              <p className="growth-card__meta">
                <span className={severityClass(b.severity)}>{b.label}</span> {dayText(b.expires_on)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {state?.expiry_tracking ? (
        <p className="form__note">
          <Link className="link" to="/more/expiry">
            Open Expiry
          </Link>
        </p>
      ) : null}
    </section>
  );
}
