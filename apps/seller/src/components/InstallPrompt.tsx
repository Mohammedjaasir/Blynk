import { useSyncExternalStore } from 'react';
import { IOS_HINT } from '../lib/install';
import type { InstallController } from '../lib/install';
import { installController as appController } from '../lib/installController';
import { IconDownload, IconInfo } from './icons';

/**
 * "Install the Blynk Seller app": a small strip above the page. A button on Android and
 * desktop Chrome (the browser's install event), the one-line Share hint on an iPhone, and
 * nothing once the app is installed or the seller said "Not now".
 */
export function InstallPrompt({ controller = appController }: { controller?: InstallController }) {
  const installController = controller;
  const mode = useSyncExternalStore(installController.subscribe, installController.getMode, installController.getMode);
  if (mode === 'hidden') return null;

  return (
    <div className="install" role="region" aria-label="Install the app" data-testid="install-prompt" data-mode={mode}>
      <span className="install__icon" aria-hidden="true">
        {mode === 'ios' ? <IconInfo size={20} /> : <IconDownload size={20} />}
      </span>
      <p className="install__text">
        <strong>Install the Blynk Seller app</strong>
        {mode === 'ios' ? <span>{IOS_HINT}</span> : <span>One tap from your home screen, and notifications.</span>}
      </p>
      <div className="install__actions">
        {mode === 'prompt' ? (
          <button type="button" className="button button--primary button--small" onClick={() => void installController.install()}>
            Install app
          </button>
        ) : null}
        <button type="button" className="button button--link" onClick={() => installController.dismiss()}>
          Not now
        </button>
      </div>
    </div>
  );
}
