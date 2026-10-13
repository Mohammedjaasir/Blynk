import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';

/**
 * Splash — mirrors the original: the launcher icon grows into a full-screen green
 * card (container transform), the wordmark pops, then everything fades into Home
 * which is already showing its "Locating…" skeleton underneath.
 */
export default function Splash() {
  const { width, height } = useWindowDimensions();
  const grow = useSharedValue(0);
  const logo = useSharedValue(0);
  const basket = useSharedValue(0);

  useEffect(() => {
    grow.value = withTiming(1, { duration: 420, easing: Easing.bezier(0.2, 0.9, 0.1, 1) });
    logo.value = withDelay(260, withSpring(1, { damping: 10, stiffness: 140 }));
    basket.value = withDelay(
      520,
      withSequence(
        withTiming(-14, { duration: 180, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 6, stiffness: 260 }),
      ),
    );
    const t = setTimeout(() => router.replace('/home'), 1350);
    return () => clearTimeout(t);
  }, []);

  const card = useAnimatedStyle(() => ({
    width: interpolate(grow.value, [0, 1], [64, width]),
    height: interpolate(grow.value, [0, 1], [64, height]),
    borderRadius: interpolate(grow.value, [0, 1], [18, 0]),
  }));
  const word = useAnimatedStyle(() => ({ opacity: logo.value, transform: [{ scale: interpolate(logo.value, [0, 1], [0.6, 1]) }] }));
  const bk = useAnimatedStyle(() => ({ transform: [{ translateY: basket.value }, { rotate: `${basket.value * -0.8}deg` }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.card, card]} />
      <Animated.View style={[styles.center, word]}>
        <Animated.Text style={[styles.basket, bk]}>🧺</Animated.Text>
        <Text style={styles.word}>tokri</Text>
        <Text style={styles.tag}>Mandi prices. Doorstep fast.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', backgroundColor: C.green },
  center: { alignItems: 'center' },
  basket: { fontSize: 56 },
  word: { fontFamily: F.display, fontSize: 46, color: C.yellow, marginTop: 4, letterSpacing: 1 },
  tag: { fontFamily: F.semi, color: '#fff', opacity: 0.9, fontSize: 14, marginTop: 4 },
});
