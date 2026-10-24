import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { RiderAutoAssignSetting } from '../api/types';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/inventory';
import { DISTANCE_MAX_KM, DISTANCE_MIN_KM, WAIT_MAX_SECONDS, WAIT_MIN_SECONDS, parseDistanceKm, parseWaitSeconds, waitLabel } from '../lib/riderAutoAssign';
import { Spinner } from './ui';

/**
 * Automatic rider assignment (owner, 2026-10-25): `GET|PUT /admin/settings/rider-auto-assign`
 * (ADMIN, OPERATIONS; audited). Off by default. The switch saves at once; the two numbers save with
 * the button. The worker uses the new values on its next 20-second tick.
 */
export function RiderAutoAssignCard() {
  const [current, setCurrent] = useState<RiderAutoAssignSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wait, setWait] = useState('');
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: RiderAutoAssignSetting) {
    setCurrent(s);
    setWait(String(s.wait_seconds));
    setKm(String(s.max_distance_km));
  }

  useEffect(() => {
    settings.riderAutoAssign
      .get()
      .then(show)
      .catch((err) => setLoadError(errorMessage(err, 'Could not load automatic assignment.')));
  }, []);

  async function toggle() {
    if (!current) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await settings.riderAutoAssign.update({ enabled: !current.enabled });
      show(saved);
      setNotice(saved.enabled ? 'Automatic assignment is on.' : 'Automatic assignment is off.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const w = parseWaitSeconds(wait);
    if ('error' in w) return setError(w.error);
    const d = parseDistanceKm(km);
    if ('error' in d) return setError(d.error);
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.riderAutoAssign.update({ wait_seconds: w.value, max_distance_km: d.value });
      show(saved);
      setNotice(`Saved: wait ${waitLabel(saved.wait_seconds)}, within ${saved.max_distance_km} km.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="rider-auto-assign" aria-labelledby="rider-auto-assign-title">
      <h2 className="section-label" id="rider-auto-assign-title">
        Automatic rider assignment
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading automatic assignment" />
      ) : (
        <>
          <p className="card__row">
            <span className="card__label">Assign orders automatically</span>
            <button
              type="button"
              role="switch"
              aria-checked={current.enabled}
              aria-label="Assign orders automatically"
              className="switch"
              disabled={saving}
              onClick={() => void toggle()}
            >
              <span className="switch__thumb" aria-hidden="true" />
            </button>
          </p>
          <form className="form" onSubmit={save} noValidate>
            <label className="field">
              <span className="field__label">Wait before assigning (seconds)</span>
              <input className="input" inputMode="numeric" value={wait} onChange={(e) => setWait(e.target.value)} aria-invalid={error ? true : undefined} />
              <span className="field__hint">
                {WAIT_MIN_SECONDS} to {WAIT_MAX_SECONDS}. Staff can still assign by hand first.
              </span>
            </label>
            <label className="field">
              <span className="field__label">Rider must be within (km of the drop-off)</span>
              <input className="input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} aria-invalid={error ? true : undefined} />
              <span className="field__hint">
                {DISTANCE_MIN_KM} to {DISTANCE_MAX_KM} km, straight line.
              </span>
            </label>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </form>
        </>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">
        When on, an order that has waited this long and was never assigned by staff goes to the nearest free rider who is on duty,
        under the trip limits, within the distance above and seen in the last 15 minutes. It never changes an order staff assigned, and does
        nothing while the store is closed. If no rider qualifies, staff get one notification. A rider's position is only known
        while a delivery is on the road, so a rider who has not delivered lately cannot be picked.
      </p>
    </section>
  );
}
