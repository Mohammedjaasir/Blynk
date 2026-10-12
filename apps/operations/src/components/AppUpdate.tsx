import { useEffect } from 'react';
import {
  APP_LABEL,
  currentDecision,
  formatSize,
  updateStore,
  useUpdateState,
  type UpdateManifest,
  type UpdateState,
} from '../lib/app-update';

/**
 * In-app updates (owner, 2026-10-12; lib/app-update.ts). Rendered once in
 * App, above the routes, and told whether someone is signed in:
 * - signed out: nothing at all - the APKs and their manifest are only for
 *   signed-in staff, and the login screen must always stay usable.
 * - 'required' (Admin/Operations set a minimum version): a full-screen
 *   "Update required" with only the Update button.
 * - 'available': a card at the bottom - Update, or Later (hidden for a day).
 */
export function AppUpdatePrompt({ signedIn }: { signedIn: boolean }) {
  const s = useUpdateState();
  useEffect(() => {
    void updateStore.start();
  }, []);
  useEffect(() => {
    updateStore.setSignedIn(signedIn);
  }, [signedIn]);
  const decision = currentDecision(s);

  if (decision.kind === 'required') {
    return (
      <div className="app-update app-update--blocking" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
        <div className="app-update__panel">
          <h1 id="app-update-title" className="app-update__title">
            Update required
          </h1>
          <p className="app-update__text">
            {decision.manifest
              ? `Install ${APP_LABEL} ${decision.manifest.version_name} to keep using the app.`
              : `This version of ${APP_LABEL} is no longer supported. Connect to the internet to get the update.`}
          </p>
          {decision.notes ? <p className="app-update__notes">{decision.notes}</p> : null}
          {decision.manifest ? (
            <InstallControls state={s} manifest={decision.manifest} />
          ) : (
            <button type="button" className="app-update__primary" disabled={s.checking} onClick={() => void updateStore.check({ force: true })}>
              {s.checking ? 'Checking…' : 'Try again'}
            </button>
          )}
          <p className="app-update__fine">Your data and sign-in are kept.</p>
        </div>
      </div>
    );
  }

  if (decision.kind === 'available') {
    return (
      <aside className="app-update app-update--banner" aria-labelledby="app-update-title">
        <p id="app-update-title" className="app-update__title">
          Update available — v{decision.manifest.version_name}
        </p>
        {decision.notes ? <p className="app-update__notes">{decision.notes}</p> : null}
        <InstallControls state={s} manifest={decision.manifest} onLater={() => updateStore.dismiss()} />
      </aside>
    );
  }
  return null;
}

/** Update button, install permission, progress and errors (shared by both prompts and More). */
function InstallControls({ state, manifest, onLater }: { state: UpdateState; manifest: UpdateManifest; onLater?: () => void }) {
  if (state.phase === 'permission') {
    return (
      <div className="app-update__step">
        <p className="app-update__text">
          To update, allow {APP_LABEL} to install apps: tap Open settings, turn on <strong>Allow from this source</strong>, then
          come back and tap Update.
        </p>
        <div className="app-update__actions">
          <button type="button" className="app-update__primary" onClick={() => void updateStore.openInstallSettings()}>
            Open settings
          </button>
          <button type="button" className="app-update__secondary" onClick={() => updateStore.resetPhase()}>
            I have allowed it
          </button>
        </div>
      </div>
    );
  }
  if (state.phase === 'downloading') {
    const percent = Math.round((state.progress ?? 0) * 100);
    return (
      <div className="app-update__step">
        <p className="app-update__text" role="status">
          Downloading the update… {percent}% of {formatSize(manifest.size)}
        </p>
        <progress className="app-update__progress" max={100} value={percent} aria-label="Download progress" />
      </div>
    );
  }
  if (state.phase === 'installing') {
    return (
      <div className="app-update__step">
        <p className="app-update__text" role="status">
          Android&apos;s install screen is open. Tap <strong>Install</strong>.
        </p>
        <button type="button" className="app-update__secondary" onClick={() => void updateStore.install()}>
          Open it again
        </button>
      </div>
    );
  }
  return (
    <div className="app-update__step">
      {state.installError ? (
        <p className="app-update__error" role="alert">
          {state.installError}
        </p>
      ) : null}
      <div className="app-update__actions">
        <button type="button" className="app-update__primary" onClick={() => void updateStore.install()}>
          {state.installError ? 'Try again' : 'Update'}
        </button>
        {onLater ? (
          <button type="button" className="app-update__secondary" onClick={onLater}>
            Later
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** More > "App version": the installed version and "Check for updates". */
export function AppVersionCard() {
  const s = useUpdateState();
  useEffect(() => {
    void updateStore.start();
  }, []);
  // Ignores "Later": the card always says when a newer version exists.
  const decision = currentDecision({ ...s, dismissed: null });
  const latest = decision.kind === 'none' ? null : decision.manifest;

  return (
    <section className="card" aria-labelledby="app-version-title">
      <h2 className="section-label" id="app-version-title">
        App version
      </h2>
      {s.supported === false ? (
        <p className="quiet">Updates are installed from the Android app.</p>
      ) : !s.installed ? (
        <p className="quiet">Reading the installed version…</p>
      ) : (
        <>
          <p className="card__row">
            <span className="card__label">Installed</span>
            <span className="card__value">
              {APP_LABEL} {s.installed.versionName} (build {s.installed.versionCode})
            </span>
          </p>
          {latest ? (
            <>
              <p className="quiet">Version {latest.version_name} is available.</p>
              <InstallControls state={s} manifest={latest} />
            </>
          ) : s.offline ? (
            <p className="field__error">Could not check for updates. Check your connection.</p>
          ) : s.lastChecked !== null && !s.checking ? (
            <p className="quiet quiet--ok" role="status">
              You have the latest version.
            </p>
          ) : null}
          <button
            type="button"
            className="button button--ghost"
            disabled={s.checking}
            onClick={() => void updateStore.check({ force: true })}
          >
            {s.checking ? 'Checking…' : 'Check for updates'}
          </button>
        </>
      )}
    </section>
  );
}
