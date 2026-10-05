import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/format';
import { getLocationMode, subscribeLocationMode, type LocationMode } from '../lib/location-mode';
import type { TrackingState } from '../lib/tracking';

/** How often the elapsed text is refreshed while it is on screen. */
const ELAPSED_TICK_MS = 5_000;

function secondsSince(when: Date): number {
  return Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
}

/**
 * "4s ago" / "2 min ago" for a past moment, kept truthful: it re-renders on a
 * low-frequency tick of its own, so the text ages even when the tracker
 * emits no state change. The interval exists only while this is mounted and
 * is cleared on unmount.
 */
function Elapsed({ since }: { since: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return <>{formatElapsed(secondsSince(since))}</>;
}

/**
 * A small, passive readout of the location-sharing state (common.md rule 10;
 * task-F4-brief.md's "status readout only" instruction). Ported exactly from
 * apps/rider/src/components/TrackingStatus.tsx (a deliberate, tested design
 * decision, per this task's brief) - common.md rule 2 (fresh implementation,
 * not an import). It never shows a coordinate - only whether sharing is on,
 * just stopped, or blocked, and roughly how fresh the last confirmed send
 * was.
 *
 * Precedence: blocking errors (permission, GPS) first, then stopped, then the
 * live state, where a failed send is flagged as a retrying warning rather
 * than hidden behind an otherwise healthy-looking line.
 */
function useLocationMode(): LocationMode {
  const [mode, setMode] = useState<LocationMode>(() => getLocationMode());
  useEffect(() => {
    setMode(getLocationMode());
    return subscribeLocationMode(setMode);
  }, []);
  return mode;
}

export function TrackingStatus({ state }: { state: TrackingState }) {
  // 'web' = browser; 'background' = Android, keeps going when locked;
  // 'foreground' = Android, the operator declined (lib/location-mode.ts).
  const mode = useLocationMode();
  // Denied at pickup, or revoked mid-session. Either way nothing is being
  // shared, whatever `active` says, so this outranks every other state.
  if (state.permission === 'denied' || state.lastError === 'permission_denied') {
    return (
      <p className="tracking-status tracking-status--error">
        {mode === 'web'
          ? "Location permission is off — turn it on in your browser's settings so this customer's delivery can be tracked."
          : "Location permission is off — turn it on in your phone's settings so this customer's delivery can be tracked."}
      </p>
    );
  }
  // The browser could not provide Geolocation at all (unsupported browser,
  // no navigator.geolocation), so tracking never started. Less specific than
  // a denial, so it sits below it, but it still outranks everything else.
  if (state.permission === 'unavailable' && !state.active) {
    return (
      <p className="tracking-status tracking-status--error">
        Location isn't available in this browser — live tracking needs a browser with Geolocation support.
      </p>
    );
  }
  if (state.lastError === 'position_unavailable') {
    return <p className="tracking-status tracking-status--error">Can't get a location — check GPS/location services are on.</p>;
  }
  if (!state.active) {
    return state.lastSentAt ? <p className="tracking-status">Stopped sharing your location.</p> : null;
  }
  const { lastSentAt } = state;
  if (state.lastError === 'network') {
    // A self-healing hiccup, not a blocker: styled as a warning, never as the
    // inverted "stop" treatment the blocking errors use.
    return (
      <p className="tracking-status tracking-status--retrying">
        <span>Couldn't send the last location — retrying.</span>
        {lastSentAt ? (
          <span>
            {' '}
            Last sent <Elapsed since={lastSentAt} />.
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <>
      <p className="tracking-status tracking-status--active">
        {mode === 'web'
          ? 'Sharing your location (this browser tab only)'
          : mode === 'background'
            ? 'Sharing your location, also while your screen is off'
            : 'Sharing your location'}
        {lastSentAt ? (
          <>
            {' — updated '}
            <Elapsed since={lastSentAt} />
          </>
        ) : null}
      </p>
      {mode === 'foreground' ? <p className="tracking-status">Location stops when your screen is off.</p> : null}
    </>
  );
}
