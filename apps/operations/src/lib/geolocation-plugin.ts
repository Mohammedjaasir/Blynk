/**
 * FOREGROUND-ONLY browser Geolocation adapter for Operations' Delivery Mode
 * (common.md rule 10; task-F4-brief.md's "Live location" section - read
 * both before touching this file).
 *
 * This is the ONLY file in the Operations app allowed to read
 * `navigator.geolocation` directly, mirroring the role
 * apps/rider/src/lib/tracking-plugin.ts plays for the Rider app's own
 * plugin - but this is deliberately NOT that file's Capacitor adapter, and
 * NOT a port of it. It is a plain, standard `navigator.geolocation.watchPosition`/
 * `clearWatch` wrapper:
 *
 *   - NO Capacitor, NO `@capacitor-community/background-geolocation`, NO
 *     native background-location plugin of any kind - explicitly out of
 *     scope for this pass (common.md rule 10). That is a large, separate
 *     undertaking on the scale of the Rider app's own live-location phase.
 *   - It tracks ONLY while the app (any screen - see tracker-session.ts) is
 *     open and (per most browsers' and Android WebView's power-saving
 *     behaviour) foregrounded - unlike the Rider app's native watcher, this has no
 *     ability to keep reporting a position once the tab is backgrounded,
 *     closed, or the device is locked. This is a genuinely lesser
 *     capability than the Rider app's, not an equivalent one - documented
 *     here, in task-F4-report.md, and in the Delivery Detail screen's own
 *     UI copy, so no operator or reviewer mistakes it for the same thing.
 *   - `lib/tracking.ts`'s `DeliveryTracker` class (ported unchanged, since
 *     it already depends only on the small `TrackingPlugin` interface below,
 *     never on Capacitor) is what actually owns the throttle/permission
 *     state machine; this file is only the thin adapter underneath it, so a
 *     future native wrapper (if ever built) would only need to replace this
 *     one file, exactly like Rider's own `capacitorTrackingPlugin` note
 *     says of itself.
 *
 * Every function reads `navigator.geolocation` fresh on each call rather
 * than caching a reference at module load, so a test can inject a fake
 * implementation before the plugin is ever exercised (task-F4-brief.md's
 * "write this against injectable/mockable geolocation, not real browser
 * APIs").
 */
export type TrackingPermissionState = 'not_requested' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: Date;
}

export interface TrackingPlugin {
  checkPermission(): Promise<TrackingPermissionState>;
  requestPermission(): Promise<TrackingPermissionState>;
  start(
    onPoint: (p: TrackingPoint) => void,
    onError: (code: 'permission_denied' | 'position_unavailable') => void
  ): Promise<void>;
  stop(): Promise<void>;
  /**
   * Optional: asked after location is granted and before start(). Resolves
   * false when the watcher's notification will be hidden (Android 13+
   * notifications refused). Never blocks sharing - only adds a status note.
   */
  ensureNotifications?(): Promise<boolean>;
}

/** Per the W3C Geolocation API spec: `GeolocationPositionError.code` is
 * always one of these three numeric constants. Read as plain numbers rather
 * than via the `GeolocationPositionError` global constructor, which is not
 * guaranteed to exist in every test environment (e.g. jsdom does not define
 * it) even though a real browser always supplies it. */
const PERMISSION_DENIED = 1;

function getGeolocation(): Geolocation | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator.geolocation as Geolocation | undefined);
}

let watchId: number | null = null;

export const browserGeolocationPlugin: TrackingPlugin = {
  /** Non-invasive: uses the Permissions API when the browser offers it, and
   * never itself prompts the operator. Returns `not_requested` (not
   * `unavailable`) when the answer genuinely cannot be known without asking -
   * `unavailable` is reserved for "this browser has no Geolocation API at
   * all". */
  async checkPermission() {
    const geolocation = getGeolocation();
    if (!geolocation) return 'unavailable';
    if (!navigator.permissions?.query) return 'not_requested';
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (status.state === 'granted') return 'granted';
      if (status.state === 'denied') return 'denied';
      return 'not_requested';
    } catch {
      return 'not_requested';
    }
  },

  /** The Geolocation API has no separate "ask for permission" call - the
   * browser's own prompt appears the first time a position is actually
   * requested. A one-shot `getCurrentPosition` triggers (or re-checks) that
   * prompt without yet starting the ongoing watch `start()` below owns. A
   * `PERMISSION_DENIED` error means the operator said no; any other error
   * (e.g. `POSITION_UNAVAILABLE`/`TIMEOUT`) still means permission itself is
   * fine - the ongoing watch in `start()` is what actually reports GPS
   * trouble as it happens. */
  async requestPermission() {
    const geolocation = getGeolocation();
    if (!geolocation) return 'unavailable';
    return new Promise((resolve) => {
      geolocation.getCurrentPosition(
        () => resolve('granted'),
        (err) => resolve(err.code === PERMISSION_DENIED ? 'denied' : 'granted'),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
      );
    });
  },

  async start(onPoint, onError) {
    const geolocation = getGeolocation();
    if (!geolocation) throw new Error('Geolocation is not available in this browser.');
    watchId = geolocation.watchPosition(
      (position) => {
        onPoint({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp),
        });
      },
      (err) => onError(err.code === PERMISSION_DENIED ? 'permission_denied' : 'position_unavailable'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
  },

  async stop() {
    const geolocation = getGeolocation();
    if (watchId !== null && geolocation) {
      geolocation.clearWatch(watchId);
    }
    watchId = null;
  },
};
