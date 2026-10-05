/*
 * Native background-location adapter for the Operations Android app
 * (2026-10-02) - the ONLY file in Operations allowed to import
 * `@capacitor-community/background-geolocation`. A port of
 * apps/rider/src/lib/tracking-plugin.ts (read its compatibility notes:
 * plugin 1.2.26 on Capacitor 7.x, no Capacitor 8 support, useLegacyBridge
 * required, open issues #153/#126/#127/#135/#141), same plugin and version so
 * both apps' Gradle builds stay identical.
 *
 * How "keeps going with the screen locked" works: since plugin 1.2.23 a
 * watcher with a `backgroundMessage` runs inside a foreground service of type
 * "location" with a visible notification. A location foreground service
 * started while the app is open keeps its while-in-use location access after
 * the screen locks, so ACCESS_BACKGROUND_LOCATION ("Allow all the time") is
 * NOT needed and is deliberately not declared. The plugin's own manifest
 * contributes the service, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION
 * and POST_NOTIFICATIONS.
 *
 * Differences from Rider's adapter: the notification wording, and nothing
 * else. The location POSTs do NOT rely on a global CapacitorHttp switch -
 * see api/native-client.ts.
 */
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, CallbackError, Location } from '@capacitor-community/background-geolocation';
import type { TrackingPermissionState, TrackingPlugin } from './geolocation-plugin';

/** Inherited Capacitor bridge methods the plugin's own .d.ts does not
 * declare - see the long note in apps/rider/src/lib/tracking-plugin.ts. */
interface WithAutoPermissions {
  checkPermissions(): Promise<{ location: string }>;
  requestPermissions(): Promise<{ location: string }>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin & WithAutoPermissions>('BackgroundGeolocation');

export const NOTIFICATION_TITLE = 'Blynk Ops is sharing your location for an active delivery';
export const NOTIFICATION_MESSAGE = 'Sharing stops when you arrive or the delivery ends.';

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

export const backgroundLocationPlugin: TrackingPlugin = {
  async checkPermission() {
    try {
      return mapPermissionState((await BackgroundGeolocation.checkPermissions()).location);
    } catch {
      return 'unavailable';
    }
  },

  async requestPermission() {
    try {
      return mapPermissionState((await BackgroundGeolocation.requestPermissions()).location);
    } catch {
      return 'unavailable';
    }
  },

  async start(onPoint, onError) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: NOTIFICATION_TITLE,
        backgroundMessage: NOTIFICATION_MESSAGE,
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
