import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Android 13+ POST_NOTIFICATIONS, through the app's own tiny native plugin
 * (android/app/src/main/java/.../NotificationPermissionPlugin.java, registered
 * in MainActivity). Without it the background-location foreground service
 * still runs, but its "Sharing your location" notification is hidden from the
 * drawer. The background-geolocation plugin never asks for it (its issue #141).
 *
 * Asked right before location sharing starts (after location permission,
 * before the watcher). Never blocks sharing: a refusal only adds a note to
 * the tracking status.
 */
export type NotificationDisplayState = 'granted' | 'denied' | 'prompt';

export interface NotificationPermissionPlugin {
  check(): Promise<{ display: NotificationDisplayState }>;
  request(): Promise<{ display: NotificationDisplayState }>;
}

const alwaysGranted = async () => ({ display: 'granted' as const });

export const NotificationPermission = registerPlugin<NotificationPermissionPlugin>('NotificationPermission', {
  web: { check: alwaysGranted, request: alwaysGranted },
});

/** The one-line note shown in the tracking status when notifications are off. */
export const NOTIFICATIONS_OFF_NOTE = 'Turn on notifications so you can see when your location is shared.';

let askedThisRun = false;

function isAndroidApp(): boolean {
  try {
    return Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/**
 * Resolves true when the sharing notification can be shown. Off Android (web,
 * dev builds) it is always true. The system prompt is shown at most once per
 * app run; after that a refusal is only re-checked (the user may have turned
 * notifications on in Settings meanwhile), never asked again. Never rejects:
 * if the native plugin can't be reached it resolves true (no note).
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isAndroidApp()) return true;
  try {
    const { display } = await NotificationPermission.check();
    if (display === 'granted') return true;
    if (askedThisRun) return false;
    askedThisRun = true;
    return (await NotificationPermission.request()).display === 'granted';
  } catch {
    return true;
  }
}

/** Test-only. */
export function __resetNotificationPermissionForTests(): void {
  askedThisRun = false;
}
