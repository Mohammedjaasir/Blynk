import { useState } from 'react';
import { pushManager, useNotifyState } from '../lib/push';
import type { PushManager } from '../lib/push/manager';
import { IconAlert, IconBell, IconCheckCircle, IconInfo } from './icons';

export const NOTIFY_LEDE = 'Know when a product goes live, is not approved, or a payout is sent.';
export const TURN_ON_LABEL = 'Turn on notifications';
export const NEEDS_INSTALL_TEXT =
  'Install the app first, then turn on notifications. On an iPhone: tap Share, then Add to Home Screen, and open Blynk Seller from your Home Screen.';
export const UNSUPPORTED_TEXT =
  'This browser cannot show notifications. Try Chrome on an Android phone, or install the app on your iPhone first.';
export const DENIED_TEXT =
  "Notifications are blocked for Blynk Seller. To get them, allow notifications for this site in your browser's settings (tap the lock or the three dots next to the address), then come back and tap Check again.";
export const ON_TEXT = 'Notifications are on for this phone.';

const NUDGE_KEY = 'blynk.seller.notifyNudgeDismissed';

function nudgeDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Get notifications (push): a button that asks the browser (browsers need a tap), then the states
 * a seller can be in - unsupported browser, iPhone tab (install the app first), blocked, off, on.
 * The registration itself lives in lib/push (manager.ts).
 */
export function NotificationsCard({ manager = pushManager }: { manager?: PushManager }) {
  const state = useNotifyState(manager);
  if (state.kind === 'loading') return null;

  return (
    <section
      className="bezel notify rise"
      style={{ ['--i' as string]: 1 }}
      aria-labelledby="notify-title"
      data-testid="notify-card"
      data-state={state.kind}
    >
      <div className="bezel__core notify__core">
        <header className="notify__head">
          <span className="notify__badge" aria-hidden="true">
            <IconBell size={20} />
          </span>
          <div>
            <h2 id="notify-title" className="notify__title">
              Get notifications
            </h2>
            <p className="muted notify__lede">{NOTIFY_LEDE}</p>
          </div>
        </header>
        <NotifyBody manager={manager} />
      </div>
    </section>
  );
}

/** The state-specific part, shared by the card and the home-screen nudge. */
function NotifyBody({ manager, onSkip }: { manager: PushManager; onSkip?: () => void }) {
  const state = useNotifyState(manager);

  return (
    <div className="notify__body">
      {state.kind === 'on' ? (
        <>
          <p className="notify__state notify__state--ok" role="status">
            <IconCheckCircle size={18} /> {ON_TEXT}
          </p>
          <div className="notify__actions">
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={state.busy}
              onClick={() => void manager.turnOff()}
            >
              {state.busy ? 'Turning off...' : 'Turn off'}
            </button>
          </div>
        </>
      ) : state.kind === 'off' ? (
        <div className="notify__actions">
          <button
            type="button"
            className="button button--primary button--small"
            disabled={state.busy}
            onClick={() => void manager.turnOn()}
          >
            {state.busy ? 'Turning on...' : TURN_ON_LABEL}
          </button>
          {onSkip ? (
            <button type="button" className="button button--link" onClick={onSkip}>
              Not now
            </button>
          ) : null}
        </div>
      ) : state.kind === 'denied' ? (
        <>
          <p className="notify__state notify__state--warn">
            <IconAlert size={18} /> {DENIED_TEXT}
          </p>
          <div className="notify__actions">
            <button type="button" className="button button--ghost button--small" onClick={() => manager.refresh()}>
              Check again
            </button>
          </div>
        </>
      ) : state.kind === 'needs-install' ? (
        <p className="notify__state">
          <IconInfo size={18} /> {NEEDS_INSTALL_TEXT}
        </p>
      ) : (
        <p className="notify__state">
          <IconInfo size={18} /> {UNSUPPORTED_TEXT}
        </p>
      )}
      {state.error ? (
        <p className="field__error notify__error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * On the home screen: a short invitation, only while notifications can be turned on and the
 * seller has not said "Not now". Everything else lives on My shop.
 */
export function NotificationsNudge({ manager = pushManager }: { manager?: PushManager }) {
  const state = useNotifyState(manager);
  const [skipped, setSkipped] = useState(nudgeDismissed);
  if (state.kind !== 'off' || skipped) return null;

  return (
    <section className="bezel notify notify--nudge rise" aria-labelledby="nudge-title" data-testid="notify-nudge">
      <div className="bezel__core notify__core">
        <header className="notify__head">
          <span className="notify__badge" aria-hidden="true">
            <IconBell size={20} />
          </span>
          <div>
            <h2 id="nudge-title" className="notify__title">
              Get notifications
            </h2>
            <p className="muted notify__lede">{NOTIFY_LEDE}</p>
          </div>
        </header>
        <NotifyBody
          manager={manager}
          onSkip={() => {
            try {
              localStorage.setItem(NUDGE_KEY, '1');
            } catch {
              /* it may come back after a reload */
            }
            setSkipped(true);
          }}
        />
      </div>
    </section>
  );
}
