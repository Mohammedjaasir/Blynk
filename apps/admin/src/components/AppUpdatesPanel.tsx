import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import type { AppUpdateMode, AppUpdatesSetting } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import {
  MAX_NOTES,
  STAFF_APP_NAMES,
  fetchPublishedVersion,
  minimumWarning,
  parseMinVersionCode,
  type PublishedVersion,
  type StaffAppName,
} from '../lib/appUpdatesSettings';
import { ModeChoice } from './KmTierEditor';
import { Field, Spinner, useToast } from './ui';

const MODES: { value: AppUpdateMode; label: string }[] = [
  { value: 'optional', label: 'Optional' },
  { value: 'required', label: 'Required' },
];

interface Draft {
  min: string;
  mode: AppUpdateMode;
  notes: string;
}
type Drafts = Record<StaffAppName, Draft>;

const draftsFrom = (s: AppUpdatesSetting): Drafts => ({
  ops: { min: String(s.ops.min_version_code), mode: s.ops.mode, notes: s.ops.notes },
  rider: { min: String(s.rider.min_version_code), mode: s.rider.mode, notes: s.rider.notes },
});

/**
 * Settings > "App updates" (owner, 2026-10-12; GET|PATCH
 * /admin/settings/app-updates, audited): for Blynk Ops and Blynk Rider, the
 * latest published APK (read from https://blynk.lk/download/<app>.json), a
 * minimum version code, Optional (a reminder staff can put off for a day) or
 * Required (older apps are blocked until updated) and short release notes.
 * Operations has the same panel under More.
 */
export function AppUpdatesPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<AppUpdatesSetting | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [published, setPublished] = useState<Record<StaffAppName, PublishedVersion | null | undefined>>({
    ops: undefined,
    rider: undefined,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<StaffAppName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: AppUpdatesSetting) {
    setCurrent(s);
    setDrafts(draftsFrom(s));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getAppUpdates()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the app update settings.')));
    for (const { id } of STAFF_APP_NAMES) {
      fetchPublishedVersion(id).then((v) => !cancelled && setPublished((p) => ({ ...p, [id]: v })));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  function edit(app: StaffAppName, patch: Partial<Draft>) {
    setDrafts((d) => (d ? { ...d, [app]: { ...d[app], ...patch } } : d));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!drafts) return;
    setError(null);
    const nextErrors: Partial<Record<StaffAppName, string>> = {};
    const body = {} as Record<StaffAppName, { min_version_code: number; mode: AppUpdateMode; notes: string }>;
    for (const { id } of STAFF_APP_NAMES) {
      const parsed = parseMinVersionCode(drafts[id].min);
      if ('error' in parsed) nextErrors[id] = parsed.error;
      else body[id] = { min_version_code: parsed.value, mode: drafts[id].mode, notes: drafts[id].notes.trim() };
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    try {
      show(await settingsApi.setAppUpdates(body));
      toast.success('App update settings saved.');
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setError(detail ?? errorMessage(err, 'Could not save the app update settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="App updates">
      <h2 className="panel__title">App updates</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !drafts ? (
        <Spinner label="Loading the app update settings" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          {STAFF_APP_NAMES.map(({ id, label }) => {
            const d = drafts[id];
            const pub = published[id];
            const parsed = parseMinVersionCode(d.min);
            const warning = 'value' in parsed ? minimumWarning(parsed.value, d.mode, pub ?? null) : null;
            return (
              <fieldset key={id} className="app-updates__app" aria-label={label}>
                <legend className="field__label">{label}</legend>
                <p className="form__note" aria-label={`${label} latest published version`}>
                  Latest published:{' '}
                  {pub === undefined
                    ? 'checking…'
                    : pub
                      ? `${pub.version_name} (version code ${pub.version_code})`
                      : 'not found'}
                </p>
                <Field label={`${label} minimum version code`} hint="0 = no minimum." error={errors[id]}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={d.min}
                    onChange={(e) => edit(id, { min: e.target.value })}
                    aria-label={`${label} minimum version code`}
                  />
                </Field>
                <ModeChoice<AppUpdateMode>
                  label={`${label} update mode`}
                  value={d.mode}
                  options={MODES}
                  onChange={(mode) => edit(id, { mode })}
                />
                <Field label={`${label} release notes`} hint="Optional. Shown with the update.">
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={MAX_NOTES}
                    value={d.notes}
                    onChange={(e) => edit(id, { notes: e.target.value })}
                    aria-label={`${label} release notes`}
                  />
                </Field>
                {warning ? <p className="form__note">{warning}</p> : null}
              </fieldset>
            );
          })}
          <p className="form__note">
            Optional shows &quot;Update available&quot; when a newer APK is published; staff can put it off for a day.
            Required blocks apps below the minimum version code until they update.
          </p>
          {current?.updated_at ? <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p> : null}
          {error ? (
            <p className="field__error" role="alert">
              {error}
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
