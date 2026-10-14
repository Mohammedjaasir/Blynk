import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { GATE_PARAMS, hasSkippedLogin, startRoute } from '@/blynk/auth/gate';
import { getSession } from '@/blynk/auth/session';
import { DEMO } from '@/demo/mode';
import { SPLASH_LOGO, SPLASH_LOGO_H, SPLASH_LOGO_W, splashHandover } from '@/lib/splash';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

/**
 * The old Blynk intro, carried over from the Flutter app's BlynkLaunchScreen (owner, 2026-10-13):
 * plain white, the stacked Blynk mark over the wordmark drawn 180 tall in the centre of the
 * whole window, the mark breathes up 5 %, then the composition lifts away. The lift itself is
 * drawn over the whole window by SplashHandoverHost once the next screen has mounted, so that
 * screen fades in *under* the exit instead of after it, exactly like the original.
 *
 * The start gate (Flutter SessionGate, owner 2026-10-14): signed in, or a guest who chose
 * "Skip for now" before, goes on to Home; anyone else to the phone-number login with its Skip.
 * Both are read from device storage when the intro mounts (no network), so the decision is ready
 * long before the exit and adds no wait. Links straight to a page never come through here.
 */
const SEQUENCE = 1100; // ms, the whole original sequence
const LEAVE_AT = 0.62; // the exit starts here (and Home takes over)

export default function Splash() {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);
  const [target] = useState(() => startRoute({ demo: DEMO, signedIn: !!getSession(), skipped: () => hasSkippedLogin() }));

  useEffect(() => {
    const leave = () => {
      splashHandover.start(target === '/home');
      if (target === '/home') router.replace('/home');
      else router.replace({ pathname: '/login', params: GATE_PARAMS });
    };
    if (reduced) {
      const t = setTimeout(leave, 400);
      return () => clearTimeout(t);
    }
    // breath: 10 %–55 % of the sequence, ease-in-out cubic
    breath.value = withDelay(SEQUENCE * 0.1, withTiming(1, { duration: SEQUENCE * 0.45, easing: Easing.inOut(Easing.cubic) }));
    const t = setTimeout(leave, SEQUENCE * LEAVE_AT);
    return () => clearTimeout(t);
  }, []);

  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.05 * breath.value }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={a}>
        <Image source={SPLASH_LOGO} resizeMode="contain" style={styles.logo} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  logo: { height: SPLASH_LOGO_H, width: SPLASH_LOGO_W },
});
