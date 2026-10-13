import { router } from 'expo-router';
import { Platform } from 'react-native';
import { registerDevice, unregisterDevice } from '@/blynk/api/push';
import { DEMO } from '@/demo/mode';
import { createPushManager, type PushPermission } from './manager';
import { pushTargetOf } from './target';
import { createWebPushPlatform } from './webPlatform';

/*
 * The app's push instance (web PWA only; native builds have no Firebase config yet, so push is
 * off there). Started and kept in step with the session by <SessionEffects /> in the root
 * layout. Other screens only ever call requestPushPermission(), from a tap:
 *   - agent c1: right after "Place order" succeeds (Flutter: cart_screen_payment_container);
 *   - agent c3: when "Notify me" is switched on (Flutter: notify_me_button);
 *   - the account screen's "Order updates" row.
 */
export const push = createPushManager({
  platform: () => (Platform.OS === 'web' && !DEMO ? createWebPushPlatform() : null),
  register: registerDevice,
  unregister: (token, accessToken) => unregisterDevice(token, accessToken),
  onTap: (data) => {
    const target = pushTargetOf(data);
    if (target) router.push({ pathname: '/order/[id]', params: { id: target.id } });
  },
});

/** Ask to allow notifications (call it from the tap that makes them useful). Never throws. */
export function requestPushPermission(): Promise<PushPermission> {
  return push.requestPermission().catch(() => 'unsupported' as const);
}

export type { PushPermission } from './manager';
