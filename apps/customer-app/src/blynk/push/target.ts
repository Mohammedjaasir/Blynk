/*
 * Where tapping a push notification goes. The backend sends {type: 'order', order_id} for order
 * updates, {type: 'product', product_id} for "back in stock" and {type: 'appointment',
 * appointment_id} for dental reminders (backend/.../push/push.events.ts). This app opens order
 * updates on the order screen; anything else just opens the app (Flutter's PushTarget).
 */
export type PushTarget = { kind: 'order'; id: string; path: string };

export function pushTargetOf(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const id = (k: string) => {
    const v = d[k];
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    return s || null;
  };
  if (d.type === 'order') {
    const orderId = id('order_id');
    // ids are UUIDs: anything with a path character is not one of ours
    if (!orderId || /[/?#\\]/.test(orderId)) return null;
    return { kind: 'order', id: orderId, path: `/order/${encodeURIComponent(orderId)}` };
  }
  return null;
}

/**
 * A message the Firebase messaging service worker posts to the page when a notification is
 * tapped ({isFirebaseMessaging, messageType: 'notification-clicked', data}). Returns its data.
 */
export function clickedPushData(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (m.isFirebaseMessaging !== true || m.messageType !== 'notification-clicked') return null;
  return m.data && typeof m.data === 'object' ? (m.data as Record<string, unknown>) : null;
}
