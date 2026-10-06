import { ApiError } from '../api/client';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { isTrackable } from './delivery';
import { DeliveryTracker } from './tracking';
import { capacitorTrackingPlugin } from './tracking-plugin';

/**
 * The one DeliveryTracker for the whole app. The trackable window belongs to
 * the delivery, not to whichever screen happens to be open: it must resume
 * after a restart, survive navigating to the queue, and be stopped from
 * anywhere once the window closes. So the tracker lives here, and screens only
 * report what they last learned about a delivery via syncTracking().
 */
/** A refusal after which this delivery can never be shared again by this rider. */
function closesWindow(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.status === 409 || (err.status === 404 && err.code === 'DELIVERY_NOT_FOUND'))
  );
}

/** Worth sending the next point: no answer, a server error, or rate limiting. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status >= 500 || err.status === 429;
}

const PROFILE_REFUSED = new Set(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE']);

/** Why sharing stopped, in the rider's words. */
export function refusalReason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your session has ended. Sign in again to share your location.';
    if (err.status === 403 && err.code && PROFILE_REFUSED.has(err.code)) {
      return "Your rider profile isn't active, so your location can't be shared. Contact the store.";
    }
    if (err.status === 403) return "Your account can't share its location for this delivery. Contact the store.";
    if (err.status === 400) {
      return 'The server refused your location. Reopen the delivery to try again, or tell the store.';
    }
  }
  return 'Location sharing stopped. Reopen the delivery to try again, or tell the store.';
}

function createTracker(): DeliveryTracker {
  const tracker: DeliveryTracker = new DeliveryTracker(capacitorTrackingPlugin, async (deliveryId, point) => {
    try {
      await deliveriesApi.sendLocation(deliveryId, {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        captured_at: point.capturedAt.toISOString(),
      });
    } catch (err) {
      // The server is the authority on the window: 409 (cancelled, not on
      // the road) or 404 DELIVERY_NOT_FOUND (reassigned, never ours) mean
      // stop sharing, not "retry later". Only if it still concerns the
      // delivery being tracked - a late refusal for a previous delivery must
      // not stop its replacement - and through the same queue as every other
      // start/stop so it cannot interleave with one.
      if (closesWindow(err)) {
        await enqueue(async () => {
          if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
        });
        return;
      }
      // Any other refusal the API will repeat for every point (no rider
      // profile, an inactive rider, a session that could not be renewed, a
      // point it rejects) stops sharing with the reason, rather than retrying
      // every few seconds behind "retrying". Only no answer, a server error or
      // rate limiting is worth another try.
      if (!isRetryable(err)) {
        const reason = refusalReason(err);
        await enqueue(async () => {
          if (tracker.getDeliveryId() === deliveryId) await tracker.stop(reason);
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
 * Brings the device in line with what is known about ONE delivery: tracking it
 * while it is inside the trackable window. A delivery that is not trackable
 * stops tracking only if it is the one being tracked - looking at some other
 * delivery says nothing about the one on the road. A different trackable id is
 * a new tracking identity: the old one is stopped before the new one starts.
 * Idempotent and serialized; may reject if the plugin throws (callers swallow).
 */
export async function syncTracking(delivery: DeliverySummary): Promise<void> {
  const closedTracked = await enqueue(() => applyDelivery(delivery));
  // Trips: the rider may have other orders on the road. When the stop being
  // tracked closes (arrived, delivered, failed, cancelled), carry on with the
  // next one now, from the rider's list, rather than only when the Queue
  // screen is next opened.
  if (closedTracked) await resumeFromList();
}

/** Re-reads the rider's deliveries and tracks the next one on the road, if any. Never rejects. */
async function resumeFromList(): Promise<void> {
  try {
    await syncTrackingFromList(await deliveriesApi.list());
  } catch {
    // Offline or a plugin failure: the Queue and Delivery screens sync again on their next load.
  }
}

/**
 * For screens that see the whole list (the Queue) and so may say "nothing is
 * trackable anywhere". Call it only after a SUCCESSFUL load. Picks the
 * delivery already being tracked if it is still trackable, otherwise the first
 * trackable one in list order (the API's order); none trackable stops.
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

/** Stops whatever is being tracked (also retries a native stop that failed). */
export function stopTracking(): Promise<void> {
  return enqueue(applyStopAny);
}

/** Stops tracking only if it is bound to this delivery (e.g. the API says it is no longer ours). */
export function stopTrackingFor(deliveryId: string): Promise<void> {
  return enqueue(async () => {
    if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
  });
}

/** True when it stopped tracking this delivery because it left the trackable window. */
async function applyDelivery(delivery: DeliverySummary): Promise<boolean> {
  const current = tracker.getDeliveryId();
  if (isTrackable(delivery)) {
    if (current === delivery.delivery_id) return false;
    if (current !== null) await tracker.stop();
    await tracker.start(delivery.delivery_id);
    return false;
  }
  if (current === delivery.delivery_id) {
    await tracker.stop();
    return true;
  }
  if (current === null && tracker.hasPendingStop()) await tracker.stop();
  return false;
}

async function applyStopAny(): Promise<void> {
  if (tracker.getDeliveryId() !== null || tracker.hasPendingStop()) await tracker.stop();
}

/** Test-only: drops the singleton so each test starts with an idle tracker. */
export function __resetTrackerSessionForTests(): void {
  tracker = createTracker();
  queue = Promise.resolve();
}
