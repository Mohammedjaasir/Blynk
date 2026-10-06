import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/format';
import type { TrackingState } from '../lib/tracking';

/** How often the elapsed text is refreshed while it is on screen. */
const ELAPSED_TICK_MS = 5_000;

function secondsSince(when: Date): number {
  return Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
}

/**
 * "4s ago" / "2 min ago" for a past moment, kept truthful: it re-renders on a
 * low-frequency tick of its own, so the text ages even when the tracker emits
 * no state change (a silent tracker must not keep saying "updated 4s ago").
 * The interval exists only while this is mounted - i.e. only while an elapsed
 * time is actually displayed - and is cleared on unmount.
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
 * A small, passive readout of the location-sharing state (plan §13). It
 * never shows a coordinate - only whether sharing is on, just stopped, or
 * blocked, and roughly how fresh the last confirmed send was.
 *
 * Precedence: blocking errors (permission, GPS) first, then stopped, then
 * the live state, where a failed send is flagged (as a retrying warning, not
 * a blocking error) rather than hidden behind an otherwise healthy-looking
 * line.
 */
export function TrackingStatus({ state }: { state: TrackingState }) {
  // Denied at pickup, or revoked mid-session. Either way nothing is being
  // shared, whatever `active` says, so this outranks every other state.
  if (state.permission === 'denied' || state.lastError === 'permission_denied') {
    return (
      <p className="tracking-status tracking-status--error">
        Location permission is off — turn it on in your phone's settings so your customer can see you.
      </p>
    );
  }
  // The location service / plugin couldn't be reached at all (e.g. the native
  // bridge failed closed), so tracking never started. Less specific than a
  // denial, so it sits below it, but it still outranks everything else.
  if (state.permission === 'unavailable' && !state.active) {
    return (
      <p className="tracking-status tracking-status--error">
        Location isn't available on this device right now — check that location services are on and reopen the app.
      </p>
    );
  }
  // The server refused the sharing for good (profile, session, a rejected
  // point): it has stopped, and the rider is told why rather than "retrying".
  if (state.lastError === 'refused' && !state.active) {
    return (
      <p className="tracking-status tracking-status--error">
        Stopped sharing your location. {state.stopReason ?? 'Tell the store.'}
      </p>
    );
  }
  if (state.lastError === 'position_unavailable') {
    return <p className="tracking-status tracking-status--error">Can't get your location — check GPS is on.</p>;
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
        <span>Couldn't send your last location — retrying.</span>
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
    <p className="tracking-status tracking-status--active">
      Sharing your location
      {lastSentAt ? (
        <>
          {' — updated '}
          <Elapsed since={lastSentAt} />
        </>
      ) : null}
    </p>
  );
}
