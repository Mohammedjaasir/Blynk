/*
 * Compatibility notes (Task RG Step 0 desk research, 2026-09-20).
 * Verified on a real device: NOT YET - see
 * docs/06-deployment/rider-background-tracking-device-verification.md
 *
 * Pinned: @capacitor/core|android|cli 7.6.9 + @capacitor-community/background-geolocation
 * 1.2.26 (README: "v1.2.25 - Add support for Capacitor v7"). The plugin has NO Capacitor 8
 * support: issue #156 (open, Apr 2026) reports a crash on backgrounding under v8. Do not
 * upgrade Capacitor past 7.x without re-checking. Last plugin release 2025-08-28.
 * Android: minSdk 23 / compileSdk+targetSdk 35 (android/variables.gradle). Android 14 fix
 * shipped in plugin v1.2.16; foreground-service reliability in v1.2.18/19/23.
 * Manifest (merged, verified in build): the plugin AAR contributes its own
 * <service foregroundServiceType="location">, FOREGROUND_SERVICE_LOCATION and
 * POST_NOTIFICATIONS; the app manifest adds INTERNET, ACCESS_FINE/COARSE/BACKGROUND_LOCATION,
 * FOREGROUND_SERVICE. Required config: capacitor.config.ts android.useLegacyBridge = true
 * (otherwise updates halt after ~5 min in background, issue #89).
 * Known caveats (github.com/capacitor-community/background-geolocation/issues/<n>):
 *  - #153 (open): Android 14-16 throws SecurityException starting the location FGS if the
 *    watcher starts while the location permission prompt is still pending. Mitigated here
 *    by DeliveryTracker awaiting requestPermission() BEFORE start(); confirm on device.
 *  - #126 (open): a report of updates stopping after ~1 hour in background; unresolved.
 *  - #127 (open): no built-in battery-optimization exemption prompt. OEM killers
 *    (dontkillmyapp.com: Huawei, Xiaomi, OnePlus, Samsung) may still stop the service.
 *  - #135 (open): non-transparent/invalid notification icon makes the notification
 *    misbehave; the default mipmap/ic_launcher is used here - check on device.
 *  - #141 (open): the plugin never requests POST_NOTIFICATIONS. GAP: neither this file nor
 *    the app requests it, so on Android 13+ the FGS runs but its notification is hidden from
 *    the drawer (visible only in the Task Manager) unless the user grants it in Settings.
 *    Re-checked 2026-10-06: no installed package can ask for it from JS - @capacitor/core has
 *    no generic permission API, this plugin declares only the "location" alias, and the
 *    notification plugins (@capacitor/local-notifications / push-notifications) would be a new
 *    dependency. Left as a documented gap: add one of those (or a small native plugin under
 *    android/) and call its requestPermissions() before start().
 *  - HIGH RISK, MITIGATED (README + issue #14): "after 5 minutes in the background Android
 *    will throttle HTTP requests initiated from the WebView"; the fix is native HTTP
 *    (CapacitorHttp). capacitor.config.ts now sets plugins.CapacitorHttp.enabled = true, which
 *    patches global fetch to native HTTP on Android, so api/client.ts fetch() calls are no
 *    longer WebView-throttled. Still unverified on a device (runbook scenario S20). Note the
 *    patched fetch ignores AbortSignal, so client.ts races every request against its own 15 s
 *    deadline, which settles the call whatever the transport does.
 * iOS (out of scope): Info.plist NSLocationWhenInUseUsageDescription,
 * NSLocationAlwaysAndWhenInUseUsageDescription, UIBackgroundModes = [location].
 * checkPermissions()/requestPermissions() used below are inherited bridge methods, see the
 * WithAutoPermissions note; not yet exercised on a device.
 */
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, CallbackError, Location } from '@capacitor-community/background-geolocation';

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
}

/**
 * The installed @capacitor-community/background-geolocation@1.2.26 package
 * has NO `checkPermissions()`/`requestPermissions()` methods of its own -
 * neither in its native Android/iOS plugin classes nor in its
 * `definitions.d.ts`. Its only exported operations are `addWatcher`,
 * `removeWatcher`, and `openSettings` (confirmed by reading
 * node_modules/@capacitor-community/background-geolocation/README.md and
 * definitions.d.ts, and the Android native source at
 * android/src/main/java/.../BackgroundGeolocation.java).
 *
 * However, every Capacitor native plugin declared with a
 * `@CapacitorPlugin(permissions = ...)` annotation - which this plugin's
 * Android class is - automatically inherits generic `checkPermissions()`
 * and `requestPermissions()` bridge methods for free from Capacitor's base
 * `Plugin` class (see @capacitor/android's Plugin.java: `checkPermissions`
 * and `requestPermissions` around lines 777-867), even though the
 * community plugin's own TypeScript definitions never declare them. They
 * resolve to `{ location: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }`
 * (the alias "location" is the one this plugin declares for
 * ACCESS_COARSE_LOCATION/ACCESS_FINE_LOCATION). We call them via a local,
 * loosely-typed interface since the plugin's own .d.ts doesn't expose them.
 */
interface WithAutoPermissions {
  checkPermissions(): Promise<{ location: string }>;
  requestPermissions(): Promise<{ location: string }>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin & WithAutoPermissions>(
  'BackgroundGeolocation'
);

function mapPermissionState(state: string | undefined): TrackingPermissionState {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'not_requested';
    default:
      return 'unavailable';
  }
}

let watcherId: string | null = null;

/**
 * Real Capacitor adapter (plan §D.1). This is the ONLY file in the Rider
 * app allowed to import `@capacitor-community/background-geolocation`
 * directly - swapping plugins later touches only this file.
 */
export const capacitorTrackingPlugin: TrackingPlugin = {
  async checkPermission() {
    try {
      const result = await BackgroundGeolocation.checkPermissions();
      return mapPermissionState(result.location);
    } catch {
      return 'unavailable';
    }
  },

  async requestPermission() {
    try {
      const result = await BackgroundGeolocation.requestPermissions();
      return mapPermissionState(result.location);
    } catch {
      return 'unavailable';
    }
  },

  async start(onPoint, onError) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Cancel to stop sharing your location for this delivery.',
        backgroundTitle: 'Sharing your location',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position?: Location, error?: CallbackError) => {
        if (error) {
          onError(error.code === 'NOT_AUTHORIZED' ? 'permission_denied' : 'position_unavailable');
          return;
        }
        if (!position) return;
        onPoint({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          capturedAt: position.time ? new Date(position.time) : new Date(),
        });
      }
    );
  },

  async stop() {
    if (watcherId === null) return;
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
    watcherId = null;
  },
};
