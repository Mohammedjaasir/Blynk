import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearGuest, clearSelection } from '@/blynk/address/store';
import { onSessionEnd, revalidateSession, useSession } from '@/blynk/auth/session';
import { forgetCheckoutKey } from '@/blynk/orders/checkout';
import { push } from '@/blynk/push';
import { stopAllTracking } from '@/blynk/tracking/useLiveTracking';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { createSessionCleaner } from './cleanup';
import { clearNotice, showNotice, useNotice } from './notice';

/*
 * Mounted once in the root layout. It
 *  - clears this customer's local state whenever a session ends (cleanup.ts);
 *  - re-checks a restored session in the background (GET /auth/me; a refused refresh ends it);
 *  - starts web push and keeps the device registered while signed in;
 *  - shows the short app-wide notice ("You've been logged out ...").
 */

let installed = false;
function installCleanup() {
  if (installed) return;
  installed = true;
  onSessionEnd(createSessionCleaner({
    stopTracking: stopAllTracking,
    clearCart: () => cartActions.clear(),
    clearAddresses: () => { clearSelection(); clearGuest(); },
    clearCheckout: forgetCheckoutKey,
    pushSignedOut: (token) => { void push.signedOut(token); },
    notify: (text) => showNotice(text),
  }));
}

const NOTICE_MS = 4_500;

export function SessionEffects() {
  const session = useSession();
  const signedIn = !!session;
  const insets = useSafeAreaInsets();
  const notice = useNotice();
  const checked = useRef(false);

  useEffect(() => {
    installCleanup();
    if (DEMO) return;
    void push.start();
  }, []);

  useEffect(() => {
    if (DEMO || !signedIn) return;
    if (!checked.current) {
      checked.current = true;
      void revalidateSession();
    }
    void push.signedIn();
  }, [signedIn, session?.user.id]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clearNotice(notice.id), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice?.id]);

  if (!notice) return null;
  return (
    <Animated.View
      key={notice.id}
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.toast, { bottom: insets.bottom + 24 }, notice.tone === 'problem' && { backgroundColor: C.problem }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.txt} onPress={() => clearNotice(notice.id)}>{notice.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute', left: 16, right: 16, borderRadius: 14, backgroundColor: C.ink,
    paddingHorizontal: 16, paddingVertical: 13, zIndex: 1000, elevation: 8,
  },
  txt: { fontFamily: F.medium, fontSize: 13.5, color: '#fff', lineHeight: 19 },
});
