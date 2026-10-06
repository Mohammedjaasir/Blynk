import { ApiError } from '../api/client';
import { delivery as deliveryApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { deliveryLocationPlugin } from './location-mode';
import { isTrackable } from './delivery';
import { errorMessage } from './errors';
import { DeliveryTracker } from './tracking';

/**
 * The one DeliveryTracker for the Operations app, ported from
 * apps/rider/src/lib/tracker-session.ts's singleton + serialized-queue design.
 *
 * Staff riders (2026-10-01): the lead delivers from this app, so tracking
 * belongs to the delivery, not to a screen - as in the Rider app. Once a
 * delivery is on the road it keeps sharing while the operator moves around
 * the app (Home, Orders, the queue); arrival, failure, a server refusal or
 * signing out stops it. `syncTrackingFromList` lets the screens that load the
 * whole list (Delivery queue, Home) start or stop it for the list as a whole.
 *
 * The watcher underneath (2026-10-02, location-mode.ts): in the Android app,
 * once the operator agrees on the explanation screen, the same native
 * foreground-service plugin as the Rider app, so sharing continues with the
 * screen locked; posts go over native HTTP (api/native-client.ts). If they
 * decline, or on the web, the WebView's navigator.geolocation
 * (geolocation-plugin.ts), which shares only while the app is on screen.
 */
/**
 * Worth sending the next point: no answer at all (NETWORK/TIMEOUT, status
 * 0), a server problem (5xx) or being rate-limited (408/429). Anything that
 * is not an ApiError is unexpected and also treated as a passing hiccup.
 */
export function isRetryableLocationError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

/**
 * Why sharing stopped, in the operator's words, for a refusal that will not
 * change by retrying (any other 4xx): the delivery left the trackable
 * window (409) or is no longer theirs (404), their rider profile is missing
 * or switched off (403), or the session ended (401).
 */
export function locationStopReason(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code && RIDER_REFUSALS[code]) return RIDER_REFUSALS[code];
  if (err instanceof ApiError) {
    if (err.status === 409) return 'This delivery is no longer on the road.';
    if (err.status === 404 && code === 'DELIVERY_NOT_FOUND') return 'This delivery is no longer assigned to you.';
    if (err.status === 401) return 'You were signed out. Sign in again to share your location.';
  }
  return errorMessage(err, 'The server refused your location.');
}

const RIDER_REFUSALS: Record<string, string> = {
  RIDER_PROFILE_NOT_FOUND: 'No rider profile is linked to this account.',
  RIDER_INACTIVE: "This account's rider profile isn't active.",
  RIDER_PROFILE_DISABLED: 'An admin switched off your rider profile.',
};

function createTracker(): DeliveryTracker {
  const tracker: DeliveryTracker = new DeliveryTracker(deliveryLocationPlugin, async (deliveryId, point) => {
    try {
      await deliveryApi.sendLocation(deliveryId, {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        captured_at: point.capturedAt.toISOString(),
      });
    } catch (err) {
      // The server is the authority: only a connection problem, a 5xx or a
      // 429 is worth retrying with the next point. Any other refusal - 409
      // (not trackable), 404 DELIVERY_NOT_FOUND (reassigned), 403
      // RIDER_PROFILE_NOT_FOUND / RIDER_INACTIVE / RIDER_PROFILE_DISABLED,
      // a 400 - will not change by retrying: stop sharing and say why. Only
      // if it still concerns the delivery being tracked - a late refusal for
      // a previous delivery must not stop its replacement - and through the
      // same queue as every other start/stop so it cannot interleave with one.
      if (!isRetryableLocationError(err)) {
        await enqueue(async () => {
          if (tracker.getDeliveryId() === deliveryId) await tracker.stopBecause(locationStopReason(err));
        });
        return;
      }
      throw err;
    }
  });
  return tracker;
}

let tracker = createTracker();
let queue: Promise<void> = Promise.resolve();

/** Serializes every start/stop so overlapping callers can never interleave them. A failed task does not block the next. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function getTracker(): DeliveryTracker {
  return tracker;
}

/**
 * Brings the device in line with what is known about ONE delivery: tracking
 * it only while it is inside the trackable window (`isTrackable`, mirroring
 * the backend's own check exactly - common.md rule 10's central invariant:
 * never start tracking merely because a screen is open). A delivery that is
 * not trackable stops tracking only if it is the one being tracked. A
 * different trackable id is a new tracking identity: the old one is stopped
 * before the new one starts. Idempotent and serialized; may reject if the
 * plugin throws (callers swallow).
 */
export function syncTracking(delivery: DeliverySummary): Promise<void> {
  return enqueue(() => applyDelivery(delivery));
}

/**
 * For screens that see the whole list (Delivery queue, Home) and so may say
 * "nothing is trackable anywhere". Call it only after a SUCCESSFUL load.
 * Keeps the delivery already tracked if it is still trackable, otherwise the
 * first trackable one in list order; none trackable stops.
 */
export function syncTrackingFromList(deliveries: DeliverySummary[]): Promise<void> {
  return enqueue(async () => {
    const trackable = deliveries.filter(isTrackable);
    const current = tracker.getDeliveryId();
    const target = trackable.find((d) => d.delivery_id === current) ?? trackable[0];
    if (target) await applyDelivery(target);
    else await applyStopAny();
  });
}

/** Stops whatever is being tracked (also retries a stop that failed natively). */
export function stopTracking(): Promise<void> {
  return enqueue(applyStopAny);
}

/** Stops tracking only if it is bound to this delivery (e.g. the API says it
 * is no longer ours). */
export function stopTrackingFor(deliveryId: string): Promise<void> {
  return enqueue(async () => {
    if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
  });
}

async function applyDelivery(delivery: DeliverySummary): Promise<void> {
  const current = tracker.getDeliveryId();
  if (isTrackable(delivery)) {
    if (current === delivery.delivery_id) return;
    if (current !== null) await tracker.stop();
    await tracker.start(delivery.delivery_id);
  } else if (current === delivery.delivery_id || (current === null && tracker.hasPendingStop())) {
    await tracker.stop();
  }
}

async function applyStopAny(): Promise<void> {
  if (tracker.getDeliveryId() !== null || tracker.hasPendingStop()) await tracker.stop();
}

/** Test-only: drops the singleton so each test starts with an idle tracker. */
export function __resetTrackerSessionForTests(): void {
  tracker = createTracker();
  queue = Promise.resolve();
}
