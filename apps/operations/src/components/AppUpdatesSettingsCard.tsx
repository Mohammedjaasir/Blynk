import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { AppShareLinks, AppUpdateMode, AppUpdatesSetting } from '../api/types';
import { AppShareLinkControls } from './AppShareLinkControls';
import { TierModeChoice } from './KmTierEditor';
import { Spinner } from './ui';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import {
  MAX_NOTES,
  STAFF_APP_NAMES,
  fetchPublishedVersion,
  minimumWarning,
  parseMinVersionCode,
  type PublishedVersion,
  type StaffAppName,
} from '../lib/appUpdatesSettings';

const MODES: ReadonlyArray<{ id: AppUpdateMode; text: string }> = [
  { id: 'optional', text: 'Optional' },
  { id: 'required', text: 'Required' },
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
 * More > "App updates" (owner, 2026-10-12; `GET|PATCH
 * /admin/settings/app-updates`): per app the latest published APK (from the
 * signed-in GET /app-updates/manifest), a minimum version code, Optional (a
 * reminder staff can put off for a day) or Required (older apps are blocked
 * until updated), short release notes, and a temporary public share link
 * (AppShareLinkControls; audited). Same settings as Admin > Settings.
 */
export function AppUpdatesSettingsCard() {
  const [current, setCurrent] = useState<AppUpdatesSetting | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [published, setPublished] = useState<Record<StaffAppName, PublishedVersion | null | undefined>>({
    ops: undefined,
    rider: undefined,
  });
  const [shareLinks, setShareLinks] = useState<AppShareLinks | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: AppUpdatesSetting) {
    setCurrent(s);
    setDrafts(draftsFrom(s));
  }

  useEffect(() => {
    let live = true;
    settings.appUpdates
      .get()
      .then((s) => live && show(s))
      .catch((err) => live && setLoadError(catalogErrorMessage(err)));
    settings.appShareLinks
      .get()
      .then((l) => live && setShareLinks(l))
      .catch(() => live && setShareLinks(null));
    for (const { id } of STAFF_APP_NAMES) {
      fetchPublishedVersion(id).then((v) => live && setPublished((p) => ({ ...p, [id]: v })));
    }
    return () => {
      live = false;
    };
  }, []);

  function edit(app: StaffAppName, patch: Partial<Draft>) {
    setDrafts((d) => (d ? { ...d, [app]: { ...d[app], ...patch } } : d));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!drafts) return;
    setNotice(null);
    setError(null);
    const body: Record<StaffAppName, { min_version_code: number; mode: AppUpdateMode; notes: string }> = {} as never;
    for (const { id, label } of STAFF_APP_NAMES) {
      const parsed = parseMinVersionCode(drafts[id].min);
      if ('error' in parsed) {
        setError(`${label}: ${parsed.error}`);
        return;
      }
      body[id] = { min_version_code: parsed.value, mode: drafts[id].mode, notes: drafts[id].notes.trim() };
    }
    setSaving(true);
    try {
      show(await settings.appUpdates.update(body));
      setNotice('App update settings saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="app-updates-title">
      <h2 className="section-label" id="app-updates-title">
        App updates
      </h2>
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
                <p className="quiet" aria-label={`${label} latest published version`}>
                  Latest published:{' '}
                  {pub === undefined
                    ? 'checking…'
                    : pub
                      ? `${pub.version_name} (version code ${pub.version_code})`
                      : 'not found'}
                </p>
                <label className="field">
                  <span className="field__label">Minimum version code</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={d.min}
                    onChange={(e) => edit(id, { min: e.target.value })}
                    aria-label={`${label} minimum version code`}
                  />
                </label>
                <TierModeChoice<AppUpdateMode>
                  label={`${label} update mode`}
                  options={MODES}
                  value={d.mode}
                  onPick={(mode) => edit(id, { mode })}
                />
                <label className="field">
                  <span className="field__label">Release notes (optional)</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={MAX_NOTES}
                    value={d.notes}
                    onChange={(e) => edit(id, { notes: e.target.value })}
                    aria-label={`${label} release notes`}
                  />
                </label>
                {warning ? <p className="quiet">{warning}</p> : null}
                {shareLinks === null ? (
                  <p className="quiet">Could not load the share link.</p>
                ) : (
                  <AppShareLinkControls app={id} label={label} link={shareLinks?.[id]} onChange={setShareLinks} />
                )}
              </fieldset>
            );
          })}
          <p className="quiet">
            Optional shows &quot;Update available&quot; when a newer APK is published; staff can put it off for a day. Required
            blocks apps below the minimum version code until they update. 0 = no minimum.
          </p>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
