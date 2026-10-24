import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiRequest } from '../api/client';
import { isNativeApp } from '../api/native-client';
import { pushOpenPath } from './growth';

/** The new-order push title; the in-app alert (NewOrderAlert) already covers those while open. */
const NEW_ORDER_TITLE = 'New order received';
let foregroundId = 50_000;

/*
 * Firebase push for the Ops app (owner, 2026-10-19: "Ops app should send notifications when order
 * received"): the phone's token is registered with POST /me/devices, so the server's "New order
 * received" push (push.events.ts enqueueNewOrderStaffPush) reaches it even with the app closed.
 * Only in the Android app (google-services.json for lk.blynk.ops; never committed).
 */

const TOKEN_KEY = 'blynk.ops.pushToken';
/** The channel the server's pushes name (backend push.sender.ts ORDERS_CHANNEL_ID). */
export const ORDERS_CHANNEL = 'orders';

/**
 * Starts push on this phone; returns a stop function for the listeners. Tapping a push
 * calls `onOpen` with where to go (lib/growth pushOpenPath): the Orders board for a new
 * order, as before; that order's screen for a low-rating alert (2026-10-24).
 */
export async function startStaffPush(onOpen: (path: string) => void): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const handles: { remove: () => Promise<void> }[] = [];
  try {
    await PushNotifications.createChannel({
      id: ORDERS_CHANNEL,
      name: 'Orders',
      description: 'New orders to pack',
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
    // With the app open Android shows no push: show the others (e.g. "Blynk's 100th order!",
    // owner 2026-10-21) as a phone notification; new orders already ring in the app.
    handles.push(
      await PushNotifications.addListener('pushNotificationReceived', (n) => {
        if (!n.title || n.title === NEW_ORDER_TITLE) return;
        void LocalNotifications.schedule({
          notifications: [{ id: foregroundId++, title: n.title, body: n.body ?? '', extra: { to: pushOpenPath(n.data) } }],
        }).catch(() => {});
      }),
    );
    handles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (a) => onOpen(pushOpenPath(a.notification?.data))),
    );
    await PushNotifications.register();
  } catch {
    // push unavailable on this build or phone: the in-app alert still rings while the app runs
  }
  return () => handles.forEach((h) => void h.remove().catch(() => {}));
}

/** This phone registered for Firebase push (so the server's push covers the app in the background). */
export function hasStaffPushToken(): boolean {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

/** On sign-out: this phone stops getting staff pushes. */
export async function stopStaffPush(): Promise<void> {
  if (!isNativeApp()) return;
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
  if (token) await apiRequest(`/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
}
