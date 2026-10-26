import { useEffect, useSyncExternalStore } from 'react';
import { iosNeedsInstall } from '../install';
import { registerDevice, unregisterDevice, unregisterDeviceWith } from './devices';
import { createPushManager, type NotifyState, type PushManager } from './manager';
import { createWebPushPlatform } from './webPlatform';

/** The one push manager of the app (the session and the notifications card both talk to it). */
export const pushManager = createPushManager({
  platform: createWebPushPlatform,
  register: registerDevice,
  unregister: (token, accessToken) =>
    accessToken ? unregisterDeviceWith(token, accessToken) : unregisterDevice(token),
  needsInstall: iosNeedsInstall,
});

/** The notifications card's state, kept current. Also re-reads the permission when the seller comes back to the app. */
export function useNotifyState(manager: PushManager = pushManager): NotifyState {
  useEffect(() => {
    // The seller may have changed the permission in the browser settings and returned.
    const onVisible = () => {
      if (document.visibilityState === 'visible') manager.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [manager]);
  return useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);
}
