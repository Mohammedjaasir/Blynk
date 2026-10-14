import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SPLASH_LOGO, SPLASH_LOGO_H, SPLASH_LOGO_W, splashHandover } from '@/lib/splash';

/** The remaining 38 % of the original 1.1 s intro sequence (Flutter BlynkLaunchScreen). */
const EXIT_MS = 420;
/** If the next screen never says it has mounted, lift the cover anyway. */
const RELEASE_CAP_MS = 1500;

/**
 * Mounted once at the root, above every screen: the intro's exit, drawn over the whole window
 * (see splashHandover in src/lib/splash.ts). White with the logo at its breathed size; once the
 * next screen has mounted the logo lifts 28, grows 6 % and fades with the white, so that screen
 * shows through. Nothing else (the tab bar, a yellow pill, a header) can show before it lifts.
 */
export function SplashHandoverHost() {
  const state = useSyncExternalStore(splashHandover.subscribe, splashHandover.get, splashHandover.get);
  return state === 'idle' ? null : <Cover leaving={state === 'leaving'} />;
}

function Cover({ leaving }: { leaving: boolean }) {
  const v = useSharedValue(1);

  useEffect(() => {
    if (!leaving) {
      const cap = setTimeout(() => splashHandover.release(), RELEASE_CAP_MS);
      return () => clearTimeout(cap);
    }
    v.set(withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) }));
    const t = setTimeout(() => splashHandover.done(), EXIT_MS + 30);
    return () => clearTimeout(t);
  }, [leaving]);

  const coverA = useAnimatedStyle(() => ({ opacity: v.value }));
  // the original's exit curve: lift 28, grow 6 % on top of the 5 % breath, fade out
  const logoA = useAnimatedStyle(() => {
    const exit = 1 - v.value;
    return { opacity: v.value, transform: [{ translateY: -28 * exit }, { scale: 1.05 * (1 + 0.06 * exit) }] };
  });

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.cover, coverA]}>
      <Animated.Image source={SPLASH_LOGO} resizeMode="contain" style={[styles.logo, logoA]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', zIndex: 2147482000 },
  logo: { height: SPLASH_LOGO_H, width: SPLASH_LOGO_W },
});
