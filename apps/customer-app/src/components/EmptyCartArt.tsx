import { COMPONENT_WORDS } from '@/blynk/ui/componentWords';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence,
  withTiming, ZoomIn,
} from 'react-native-reanimated';

/*
 * The empty cart's picture (owner, 2026-10-22: "make this as an animation"): the basket sways
 * while groceries drop into it one after another, forever. The items are drawn behind the basket
 * so they vanish into it. Still (just the basket) when the phone asks for reduced motion.
 */
const ITEMS = [
  { glyph: '🍎', x: -44, spin: -24 },
  { glyph: '🥛', x: 6, spin: 14 },
  { glyph: '🍞', x: 40, spin: -12 },
  { glyph: '🥦', x: -18, spin: 20 },
  { glyph: '🍌', x: 24, spin: -18 },
] as const;
const GAP = 800;
const FALL = 1300;
const PERIOD = GAP * ITEMS.length;

function Drop({ glyph, x, spin, index, still }: { glyph: string; x: number; spin: number; index: number; still: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    p.value = withDelay(index * GAP, withRepeat(withSequence(
      withTiming(1, { duration: FALL, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 0 }),
      withTiming(0, { duration: PERIOD - FALL }),
    ), -1));
  }, [still]);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.12, 0.9, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: x },
      { translateY: interpolate(p.value, [0, 1], [-70, 34]) },
      { rotate: `${interpolate(p.value, [0, 1], [spin, 0])}deg` },
      { scale: interpolate(p.value, [0, 0.8, 1], [1, 0.9, 0.7]) },
    ],
  }));
  return <Animated.Text style={[styles.item, a]}>{glyph}</Animated.Text>;
}

export function EmptyCartArt() {
  const reduced = useReducedMotion();
  const sway = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    sway.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [reduced]);
  const basketA = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(sway.value, [0, 1], [0, -5]) },
      { rotate: `${interpolate(sway.value, [0, 1], [-3, 3])}deg` },
    ],
  }));
  return (
    <View style={styles.box} accessible accessibilityRole="image" accessibilityLabel={COMPONENT_WORDS.emptyBasket}>
      {ITEMS.map((it, i) => <Drop key={it.glyph} {...it} index={i} still={!!reduced} />)}
      <Animated.Text entering={ZoomIn.springify().mass(1).energyThreshold(1e-4)} style={[styles.basket, basketA]}>🧺</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 200, height: 170, alignItems: 'center', justifyContent: 'flex-end' },
  basket: { fontSize: 88, lineHeight: 104 },
  item: { position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', fontSize: 34 },
});
