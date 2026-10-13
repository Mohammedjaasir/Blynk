import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeInDown, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import Svg, { Circle, Path } from 'react-native-svg';
import { Confetti, PressScale } from '@/components/ui';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Order placed: ring draws, tick draws, badge pops, confetti rains. */
export default function Placed() {
  const { width, height } = useWindowDimensions();
  const { clear } = cartActions;
  const ring = useSharedValue(0);
  const tick = useSharedValue(0);
  const pop = useSharedValue(0);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    ring.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    tick.value = withDelay(500, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    pop.value = withDelay(450, withSpring(1, { damping: 7, stiffness: 160 }));
    const t = setTimeout(() => setBurst(Date.now()), 750);
    clear();
    return () => clearTimeout(t);
  }, []);

  const ringP = useAnimatedProps(() => ({ strokeDashoffset: 302 * (1 - ring.value) }));
  const tickP = useAnimatedProps(() => ({ strokeDashoffset: 70 * (1 - tick.value) }));
  const popA = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + pop.value * 0.3 }] }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Animated.View style={popA}>
        <Svg width={120} height={120} viewBox="0 0 120 120">
          <Circle cx={60} cy={60} r={48} fill="rgba(255,255,255,0.12)" />
          <AnimatedCircle cx={60} cy={60} r={48} stroke={C.yellow} strokeWidth={6} fill="none" strokeDasharray="302" animatedProps={ringP} strokeLinecap="round" rotation={-90} origin="60,60" />
          <AnimatedPath d="M38 62 L54 77 L84 45" stroke="#fff" strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70" animatedProps={tickP} />
        </Svg>
      </Animated.View>
      <Animated.Text entering={FadeInDown.delay(700)} style={styles.title}>Order placed!</Animated.Text>
      <Animated.Text entering={FadeInDown.delay(820)} style={styles.sub}>Your tokri is being packed 🧺{'\n'}Arriving in ~15 mins</Animated.Text>
      <Animated.View entering={FadeInDown.delay(1000)}>
        <PressScale onPress={() => router.dismissTo('/home')} style={styles.cta} haptic>
          <Text style={styles.ctaTxt}>Back to home</Text>
        </PressScale>
      </Animated.View>
      <Confetti burstKey={burst} x={width / 2} y={height * 0.4} count={60} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.display, color: C.yellow, fontSize: 30, marginTop: 20 },
  sub: { fontFamily: F.medium, color: '#fff', fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  cta: { marginTop: 28, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 30, paddingVertical: 14 },
  ctaTxt: { fontFamily: F.bold, color: C.green, fontSize: 15 },
});
