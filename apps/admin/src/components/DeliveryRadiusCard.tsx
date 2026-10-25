import { useEffect, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { DeliveryRadiusSetting } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import { MAX_RADIUS_KM, MIN_RADIUS_KM, parseRadiusKm } from '../lib/deliveryRadius';
import { Field, Spinner, useToast } from './ui';

/**
 * Settings -> Delivery radius (owner, 2026-10-25): `GET|PATCH /admin/settings/delivery-radius`
 * `{ radius_km, store_name }`. It is the active store's service radius: new addresses and orders beyond it
 * are refused (DELIVERY_OUTSIDE_RADIUS) and the customer app's delivery-area map follows it.
 */
export function DeliveryRadiusCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<DeliveryRadiusSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(setting: DeliveryRadiusSetting) {
    setCurrent(setting);
    setValue(String(Number(setting.radius_km.toFixed(2))));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getDeliveryRadius()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the delivery radius.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRadiusKm(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setDeliveryRadius(parsed.km);
      show(updated);
      toast.success(`Delivery radius is now ${updated.radius_km} km.`);
    } catch (err) {
      setError(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save the delivery radius.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="delivery-radius" aria-label="Delivery radius">
      <h2 className="panel__title">Delivery radius</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the delivery radius" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body" data-testid="delivery-radius-current">
            {current.store_name}: currently {current.radius_km} km.
          </p>
          <Field
            label="Delivery radius (km)"
            hint={`${MIN_RADIUS_KM} to ${MAX_RADIUS_KM} km from the store, up to 2 decimals.`}
            error={error ?? undefined}
          >
            <input className="input rp-num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <p className="form__note">
            Addresses and orders farther than this from the store are refused, and the delivery-area map in the customer
            app follows it. Orders already placed are not affected.
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
