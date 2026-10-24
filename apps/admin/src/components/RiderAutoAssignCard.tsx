import { useEffect, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { RiderAutoAssignSetting } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { DISTANCE_MAX_KM, DISTANCE_MIN_KM, WAIT_MAX_SECONDS, WAIT_MIN_SECONDS, parseDistanceKm, parseWaitSeconds, waitLabel } from '../lib/riderAutoAssign';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';

/**
 * Settings -> Automatic rider assignment (owner, 2026-10-25): `GET|PUT /admin/settings/rider-auto-assign`
 * (ADMIN, OPERATIONS; audited RIDER_AUTO_ASSIGN_UPDATED). Off by default. The switch saves at once; the two
 * numbers save with the button. The worker uses the new values on its next 20-second tick.
 */
export function RiderAutoAssignCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<RiderAutoAssignSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wait, setWait] = useState('');
  const [km, setKm] = useState('');
  const [waitError, setWaitError] = useState<string | undefined>();
  const [kmError, setKmError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: RiderAutoAssignSetting) {
    setCurrent(s);
    setWait(String(s.wait_seconds));
    setKm(String(s.max_distance_km));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getRiderAutoAssign()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load automatic assignment.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await settingsApi.setRiderAutoAssign({ enabled: next });
      show(saved);
      toast.success(saved.enabled ? 'Automatic assignment is on.' : 'Automatic assignment is off.');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const w = parseWaitSeconds(wait);
    const d = parseDistanceKm(km);
    setWaitError('error' in w ? w.error : undefined);
    setKmError('error' in d ? d.error : undefined);
    if ('error' in w || 'error' in d) return;
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await settingsApi.setRiderAutoAssign({ wait_seconds: w.value, max_distance_km: d.value });
      show(saved);
      toast.success(`Saved: wait ${waitLabel(saved.wait_seconds)}, within ${saved.max_distance_km} km.`);
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="rider-auto-assign" aria-label="Automatic rider assignment">
      <h2 className="panel__title">Automatic rider assignment</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading automatic assignment" />
      ) : (
        <>
          <p className="panel__body">
            <Switch checked={current.enabled} onChange={(next) => void toggle(next)} label="Assign orders automatically" disabled={saving}>
              Assign orders automatically ({current.enabled ? 'on' : 'off'})
            </Switch>
          </p>
          <form className="form" onSubmit={save} noValidate>
            <Field label="Wait before assigning (seconds)" hint={`${WAIT_MIN_SECONDS} to ${WAIT_MAX_SECONDS}. Staff can still assign by hand first.`} error={waitError}>
              <input className="input" inputMode="numeric" value={wait} onChange={(e) => setWait(e.target.value)} />
            </Field>
            <Field label="Rider must be within (km of the drop-off)" hint={`${DISTANCE_MIN_KM} to ${DISTANCE_MAX_KM} km, straight line.`} error={kmError}>
              <input className="input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
            </Field>
            {saveError ? <p className="field__error" role="alert">{saveError}</p> : null}
            <p className="form__note">
              When on, an order that has waited this long and was never assigned by staff goes to the nearest free rider who is
              on duty, under the trip limits, within the distance above and seen in the last 15 minutes. It never changes an order
              staff assigned, and does nothing while the store is closed. If no rider qualifies, staff get one notification. A
              rider's position is only known while a delivery is on the road, so a rider who has not delivered lately cannot be
              picked.
            </p>
            <div className="form__actions">
              <button type="submit" className="button" disabled={saving}>
                {saving ? <Spinner label="Saving" /> : 'Save'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
