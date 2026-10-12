import { useState } from 'react';
import { settings } from '../api/resources';
import type { AppShareLink, AppShareLinks } from '../api/types';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import {
  SHARE_DEFAULT_HOURS,
  SHARE_MAX_HOURS,
  SHARE_MIN_HOURS,
  parseShareHours,
  shareLinkUrl,
  type StaffAppName,
} from '../lib/appUpdatesSettings';

/**
 * More > App updates > "Share link" (owner, 2026-10-12): the APKs are only
 * downloadable by signed-in staff, so to put the app on a new phone
 * Operations (or Admin, in Settings) switches on a temporary public link for
 * 1-72 hours (default 24). Each switch-on makes a new link; Off (or the
 * expiry) ends it at once. Audited (PATCH /admin/settings/app-share-links).
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
  const [hours, setHours] = useState(String(SHARE_DEFAULT_HOURS));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = link?.active && link.path && link.expires_at ? link : null;
  const url = live ? shareLinkUrl(live.path!) : null;

  async function change(enabled: boolean) {
    setError(null);
    setNotice(null);
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
      onChange(await settings.appShareLinks.update(body));
      setNotice(enabled ? 'Share link is on.' : 'Share link is off.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied.');
    } catch {
      setError('Could not copy. Select the link and copy it.');
    }
  }

  return (
    <div className="app-updates__share" role="group" aria-label={`${label} share link`}>
      <p className="field__label">Share link</p>
      {link === undefined ? (
        <p className="quiet">Checking…</p>
      ) : live && url ? (
        <>
          <input className="input" readOnly value={url} aria-label={`${label} share link address`} onFocus={(e) => e.currentTarget.select()} />
          <p className="quiet">
            Anyone with this link can download {label} until {formatDateTime(live.expires_at!)}.
          </p>
          <div className="app-updates__share-row">
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
          <p className="quiet">
            Off. Only signed-in staff can download {label}. Turn on a temporary public link to install it on a new phone.
          </p>
          <div className="app-updates__share-row">
            <label className="field">
              <span className="field__label">
                Hours ({SHARE_MIN_HOURS}-{SHARE_MAX_HOURS})
              </span>
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
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
