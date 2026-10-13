import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { C, F } from '@/lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * "Offline menu price matched — Opening menu to explore…" interstitial.
 * Two pink brackets chase each other around a printed price list while the
 * caption shimmers, then we cross-fade into the store.
 */
export default function Opening() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spin = useSharedValue(0);
  const draw = useSharedValue(0);
  const shimmer = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.cubic) }), -1);
    draw.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
    shimmer.value = withRepeat(withTiming(1, { duration: 900 }), -1, false);
    const t = setTimeout(() => router.replace({ pathname: '/store/[id]', params: { id } }), 1500);
    return () => clearTimeout(t);
  }, []);

  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: interpolate(draw.value, [0, 1], [120, 30]) }));
  const txt = useAnimatedStyle(() => ({ opacity: 0.45 + Math.abs(Math.sin(shimmer.value * Math.PI)) * 0.55 }));

  return (
    <View style={styles.root}>
      <View style={styles.art}>
        <Animated.View entering={FadeInDown.springify().mass(1).energyThreshold(1e-4).damping(12)} style={styles.menu}>
          <Text style={styles.menuHead}>PRICE LIST</Text>
          {['🍎  Apples ........ ₹79', '🥛  Milk ............ ₹27', '🍞  Bread .......... ₹35', '🥚  Eggs ............ ₹45'].map((l) => (
            <Text key={l} style={styles.menuLine}>{l}</Text>
          ))}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, ring]}>
          <Svg width={170} height={170} viewBox="0 0 170 170">
            <AnimatedPath d="M85 8 A77 77 0 0 1 162 85" stroke={C.pink} strokeWidth={6} strokeLinecap="round" fill="none" strokeDasharray="121" animatedProps={arcProps} />
            <AnimatedPath d="M85 162 A77 77 0 0 1 8 85" stroke={C.pink} strokeWidth={6} strokeLinecap="round" fill="none" strokeDasharray="121" animatedProps={arcProps} />
          </Svg>
        </Animated.View>
      </View>
      <Animated.Text entering={FadeIn.delay(150)} style={styles.big}>MANDI PRICE{'\n'}MATCHED</Animated.Text>
      <Animated.Text style={[styles.small, txt]}>Opening store to explore...</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  art: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center' },
  menu: {
    width: 108, padding: 10, backgroundColor: '#fff', borderRadius: 10, transform: [{ rotate: '-8deg' }],
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, elevation: 5, gap: 4,
  },
  menuHead: { fontFamily: F.black, fontSize: 9, color: C.ink, textAlign: 'center', marginBottom: 2 },
  menuLine: { fontFamily: F.regular, fontSize: 7.5, color: C.sub },
  big: { fontFamily: F.black, color: C.pink, fontSize: 18, textAlign: 'center', marginTop: 22, lineHeight: 22 },
  small: { fontFamily: F.medium, color: C.ink, fontSize: 15, marginTop: 64 },
});
