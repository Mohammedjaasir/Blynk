import { router } from 'expo-router';
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SPLASH_LOGO, SPLASH_LOGO_H, SPLASH_LOGO_W } from '@/lib/splash';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

/**
 * The old Blynk intro, carried over from the Flutter app's BlynkLaunchScreen (owner, 2026-10-13):
 * plain white, the stacked Blynk mark over the wordmark drawn 180 tall in the centre of the
 * whole window, the mark breathes up 5 %, then the composition lifts away. The lift itself is
 * drawn by Home over its own first frame (see `fromSplash` in home.tsx), so Home fades in
 * *under* the exit instead of after it, exactly like the original.
 */
const SEQUENCE = 1100; // ms, the whole original sequence
const LEAVE_AT = 0.62; // the exit starts here (and Home takes over)

export default function Splash() {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => router.replace('/home'), 400);
      return () => clearTimeout(t);
    }
    // breath: 10 %–55 % of the sequence, ease-in-out cubic
    breath.value = withDelay(SEQUENCE * 0.1, withTiming(1, { duration: SEQUENCE * 0.45, easing: Easing.inOut(Easing.cubic) }));
    const t = setTimeout(() => router.replace('/home'), SEQUENCE * LEAVE_AT);
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
