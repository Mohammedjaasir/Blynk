import { useState } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { AppShareLink, AppShareLinks } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import {
  SHARE_DEFAULT_HOURS,
  SHARE_MAX_HOURS,
  SHARE_MIN_HOURS,
  parseShareHours,
  shareLinkUrl,
  type StaffAppName,
} from '../lib/appUpdatesSettings';
import { useToast } from './ui';

/**
 * Settings > App updates > "Share link" (owner, 2026-10-12): the APKs are only
 * downloadable by signed-in staff, so to put the app on a new phone Admin or
 * Operations switches on a temporary public link for 1-72 hours (default 24).
 * Each switch-on makes a new link; Off (or the expiry) ends it at once.
 * Audited (PATCH /admin/settings/app-share-links). Operations has the same.
 */
export function AppShareLinkControls({
  app,
  label,
  link,
  onChange,
}: {
  app: StaffAppName;
  label: string;
  link: AppShareLink | null | undefined;
  onChange: (links: AppShareLinks) => void;
}) {
  const toast = useToast();
  const [hours, setHours] = useState(String(SHARE_DEFAULT_HOURS));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = link?.active && link.path && link.expires_at ? link : null;
  const url = live ? shareLinkUrl(live.path!) : null;

  async function change(enabled: boolean) {
    setError(null);
    let body: { app: StaffAppName; enabled: boolean; hours?: number } = { app, enabled };
    if (enabled) {
      const parsed = parseShareHours(hours);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      body = { ...body, hours: parsed.value };
    }
    setBusy(true);
    try {
      onChange(await settingsApi.setAppShareLink(body));
      toast.success(enabled ? `${label} share link is on.` : `${label} share link is off.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the share link.'));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      setError('Could not copy. Select the link and copy it.');
    }
  }

  return (
    <div className="app-updates__share" role="group" aria-label={`${label} share link`}>
      <p className="field__label">Share link</p>
      {link === undefined ? (
        <p className="form__note">Checking…</p>
      ) : live && url ? (
        <>
          <input className="input" readOnly value={url} aria-label={`${label} share link address`} onFocus={(e) => e.currentTarget.select()} />
          <p className="form__note">
            Anyone with this link can download {label} until {new Date(live.expires_at!).toLocaleString()}.
          </p>
          <div className="form__actions">
            <button type="button" className="button" onClick={() => void copy()}>
              Copy link
            </button>
            <button type="button" className="button button--ghost" disabled={busy} onClick={() => void change(false)}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="form__note">
            Off. Only signed-in staff can download {label}. Turn on a temporary public link to install it on a new phone.
          </p>
          <div className="app-updates__share-row">
            <label className="field">
              <span className="field__label">Hours ({SHARE_MIN_HOURS}-{SHARE_MAX_HOURS})</span>
              <input
                className="input"
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-label={`${label} share link hours`}
              />
            </label>
            <button type="button" className="button" disabled={busy} onClick={() => void change(true)}>
              Turn on share link
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
