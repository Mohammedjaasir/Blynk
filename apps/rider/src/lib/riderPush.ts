import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiRequest } from '../api/client';

/*
 * Firebase push for the Rider app (owner, 2026-10-21: "if we assign new delivery to the rider,
 * they don't get any notifications"): the phone's token is registered with POST /me/devices, so
 * the server's "New delivery assigned" push (push.events.ts enqueueRiderAssignedPush) reaches it
 * even with the app closed. Android app only (google-services.json for lk.blynk.rider; never
 * committed).
 */

const TOKEN_KEY = 'blynk.rider.pushToken';
/** The channel the server's pushes name (backend push.sender.ts ORDERS_CHANNEL_ID). */
export const ORDERS_CHANNEL = 'orders';
/** Screens listening for this re-read at once (lib/useRevalidate.ts). */
export const ASSIGNMENT_EVENT = 'blynk:assignment';

export interface RiderPushHandlers {
  /** A notification was tapped: open this delivery (or the list when unknown). */
  onOpen(deliveryId: string | null): void;
  /** One arrived while the app is open (Android does not show it then). */
  onForeground(title: string, body: string, deliveryId: string | null): void;
}

const isAndroidApp = () => {
  try {
    return Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};

const deliveryIdOf = (data: unknown) => {
  const id = (data as { delivery_id?: unknown } | undefined)?.delivery_id;
  return typeof id === 'string' && id ? id : null;
};

/** Starts push on this phone; returns a stop function for the listeners. */
export async function startRiderPush(handlers: RiderPushHandlers): Promise<() => void> {
  if (!isAndroidApp()) return () => {};
  const handles: { remove: () => Promise<void> }[] = [];
  try {
    await PushNotifications.createChannel({
      id: ORDERS_CHANNEL,
      name: 'Deliveries',
      description: 'New deliveries assigned to you',
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => {});
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return () => {};
    handles.push(
      await PushNotifications.addListener('registration', (t) => {
        try {
          localStorage.setItem(TOKEN_KEY, t.value);
        } catch {
          // storage blocked: the token is still registered below
        }
        void apiRequest('/me/devices', { method: 'POST', body: { token: t.value, platform: 'android' } }).catch(() => {});
      }),
    );
    handles.push(await PushNotifications.addListener('registrationError', () => {}));
    handles.push(
      await PushNotifications.addListener('pushNotificationReceived', (n) => {
        window.dispatchEvent(new Event(ASSIGNMENT_EVENT));
        handlers.onForeground(n.title ?? 'New delivery assigned', n.body ?? '', deliveryIdOf(n.data));
      }),
    );
    handles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
        window.dispatchEvent(new Event(ASSIGNMENT_EVENT));
        handlers.onOpen(deliveryIdOf(a.notification.data));
      }),
    );
    await PushNotifications.register();
  } catch {
    // push unavailable on this build or phone: the list still refreshes every 30 s
  }
  return () => handles.forEach((h) => void h.remove().catch(() => {}));
}

/** On sign-out (while still signed in): this phone stops getting this rider's pushes. */
export async function stopRiderPush(): Promise<void> {
  if (!isAndroidApp()) return;
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
  if (token) await apiRequest(`/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
}
