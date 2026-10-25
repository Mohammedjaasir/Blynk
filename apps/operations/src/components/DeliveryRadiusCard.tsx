import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { DeliveryRadiusSetting } from '../api/types';
import { MAX_RADIUS_KM, MIN_RADIUS_KM, parseRadiusKm } from '../lib/deliveryFee';
import { catalogErrorMessage } from '../lib/catalog';
import { Spinner } from './ui';

/**
 * Delivery radius (2026-10-25): `GET|PATCH /admin/settings/delivery-radius`
 * (ADMIN, OPERATIONS). It changes the active store's service radius: new
 * addresses and orders beyond it are refused, and the customer app's
 * delivery-area map follows it.
 */
export function DeliveryRadiusCard() {
  const [current, setCurrent] = useState<DeliveryRadiusSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: DeliveryRadiusSetting) {
    setCurrent(s);
    setKm(String(s.radius_km));
  }

  useEffect(() => {
    settings.deliveryRadius
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseRadiusKm(km);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.deliveryRadius.update(parsed.value);
      show(saved);
      setNotice(`Delivery radius saved: ${saved.radius_km} km.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="delivery-radius" aria-labelledby="delivery-radius-title">
      <h2 className="section-label" id="delivery-radius-title">
        Delivery radius
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading delivery radius" />
      ) : (
        <>
          <p className="card__row">
            <span className="card__label">Store</span>
            <span className="card__value" data-testid="radius-store">
              {current.store_name}
            </span>
          </p>
          <p className="card__row">
            <span className="card__label">Delivers within</span>
            <span className="card__value mono">{current.radius_km} km</span>
          </p>
          <form className="form" onSubmit={save} noValidate>
            <div className="fee-form">
              <label className="field">
                <span className="field__label">Delivery radius (km)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  aria-invalid={error ? true : undefined}
                />
              </label>
              <button type="submit" className="button" disabled={saving}>
                {saving ? <Spinner label="Saving" /> : 'Save'}
              </button>
            </div>
            <span className="field__hint">
              {MIN_RADIUS_KM} to {MAX_RADIUS_KM} km, at most 2 decimals.
            </span>
          </form>
        </>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      <p className="page__note">
        New addresses and orders beyond this distance from the store are refused, and the customer app's delivery-area map follows it.
      </p>
    </section>
  );
}
