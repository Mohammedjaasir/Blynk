import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { expiryApi, expiryErrorMessage, type ProductExpiry } from '../api/expiry';
import { batchTitle, dayText, severityClass } from '../lib/expiry';
import { Switch } from './Switch';
import { useToast } from './ui';
import '../pages/expiry.css';

/**
 * "Track expiry dates" on a product's edit form (wave 2, 2026-10-25; migration 059). The switch saves at
 * once (it is its own call, not part of the product save) and is a hint for staff screens: Restock and the
 * Expiry page ask for a date on tracked products. It never hides or blocks a product. Lists the product's
 * open batches. Nothing shows before migration 059 (or when the section cannot load).
 */
export function ProductExpirySection({ productId }: { productId: string }) {
  const toast = useToast();
  const [state, setState] = useState<ProductExpiry | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    expiryApi
      .product(productId)
      .then((s) => live && setState(s))
      // Not switched on yet (503) or not reachable: the product form stays as it was; the Expiry page explains.
      .catch(() => live && setHidden(true));
    return () => {
      live = false;
    };
  }, [productId]);

  if (hidden) return null;

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(await expiryApi.setTracking(productId, next));
      toast.success(next ? 'Expiry dates are tracked for this product.' : 'Expiry dates are no longer tracked for this product.');
    } catch (err) {
      setError(expiryErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form__section product-expiry" aria-label="Expiry dates">
      <h2 className="form__section-title">Expiry dates</h2>
      <Switch checked={state?.expiry_tracking ?? false} onChange={(v) => void change(v)} label="Track expiry dates" disabled={!state || busy}>
        Track expiry dates
      </Switch>
      <p className="form__note">
        Staff note each batch's expiry date when stock arrives and see what is expiring on the Expiry page. It never hides the product.
      </p>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {state && state.batches.length > 0 ? (
        <ul className="product-expiry__list" aria-label="Open batches">
          {state.batches.map((b) => (
            <li key={b.id}>
              <span className={severityClass(b.severity)}>{b.label}</span>
              <span>
                {b.quantity} x {batchTitle(b)}
                {b.batch_code ? ` (${b.batch_code})` : ''}, {dayText(b.expires_on)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {state?.expiry_tracking ? (
        <p className="form__note">
          <Link className="link" to="/expiry">
            Open the Expiry page
          </Link>
        </p>
      ) : null}
    </section>
  );
}
