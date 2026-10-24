import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence,
  withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { withSpring } from '@/lib/motion';
import { useActive } from '@/lib/useActive';
import { C } from '@/lib/theme';

/*
 * The repeat / buy-again artwork. Cheap on a low-end Android phone: one shared clock per drawing
 * (every piece reads it in its own animated style, on the UI thread), opacity / transform only,
 * no layout changes, and the loop runs only while its screen is the one in front. Reduced motion:
 * a still frame (the groceries resting in the basket, the icon at rest).
 */

/* ---------------------------------------------------------------- groceries popping into a basket */

const ART_W = 150;
const ART_H = 120;
const ITEM = 34;
/** Grocery glyphs, where each lands (x centre, y of its box) and when it pops up (share of the loop). */
const ITEMS = [
  { glyph: '🥛', x: 52, land: 33, at: 0.04, tilt: -8 },
  { glyph: '🍞', x: 98, land: 35, at: 0.17, tilt: 10 },
  { glyph: '🍎', x: 75, land: 38, at: 0.3, tilt: -4 },
  { glyph: '🥕', x: 62, land: 41, at: 0.43, tilt: 14 },
  { glyph: '🧀', x: 88, land: 42, at: 0.56, tilt: -12 },
] as const;
const POP = 0.05;
const HOVER = 0.03;
const DROP = 0.045;
const OUT_FROM = 0.88;
const OUT_TO = 0.95;
const LOOP_MS = 5600;
/** The frame shown with reduced motion or while the screen is not in front. */
const REST = 0.8;

function useLoop(ms: number, rest: number): SharedValue<number> {
  const reduced = useReducedMotion();
  const active = useActive();
  const t = useSharedValue(rest);
  useEffect(() => {
    if (reduced || !active) { cancelAnimation(t); t.value = rest; return; }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [reduced, active, ms, rest, t]);
  return t;
}

function Grocery({ t, item }: { t: SharedValue<number>; item: (typeof ITEMS)[number] }) {
  const top = 4;
  const a = useAnimatedStyle(() => {
    const v = t.value;
    const s0 = item.at, s1 = s0 + POP, s2 = s1 + HOVER, s3 = s2 + DROP;
    if (v < s0 || v > OUT_TO) return { opacity: 0, transform: [{ translateY: top }, { scale: 0 }] };
    let y = top, scale = 1, rot = 0, opacity = 1;
    if (v < s1) {
      // pops up with a little overshoot
      scale = interpolate(v, [s0, s0 + POP * 0.65, s1], [0.2, 1.18, 1]);
      y = top + interpolate(v, [s0, s1], [10, 0]);
    } else if (v < s2) {
      // a tiny bob in mid-air
      y = top - Math.sin(((v - s1) / HOVER) * Math.PI) * 4;
    } else if (v < s3) {
      // drops in (accelerating), tilting as it goes
      const p = (v - s2) / DROP;
      y = top + (item.land - top) * p * p;
      rot = item.tilt * p;
      scale = 1 - 0.08 * p;
    } else {
      y = item.land;
      rot = item.tilt;
      scale = 0.92;
      if (v > OUT_FROM) {
        const p = (v - OUT_FROM) / (OUT_TO - OUT_FROM);
        opacity = 1 - p;
        y = item.land + 8 * p;
      }
    }
    return { opacity, transform: [{ translateY: y }, { rotate: `${rot}deg` }, { scale }] };
  });
  return (
    <Animated.View style={[st.item, { left: item.x - ITEM / 2 }, a]}>
      <Text style={st.glyph} allowFontScaling={false}>{item.glyph}</Text>
    </Animated.View>
  );
}

/** The basket's squash each time something lands in it. */
const LANDS = ITEMS.map((i) => i.at + POP + HOVER + DROP);
function landBump(v: number): number {
  'worklet';
  let b = 0;
  for (let k = 0; k < LANDS.length; k++) {
    const d = Math.abs(v - LANDS[k]) / 0.03;
    if (d < 1) b = Math.max(b, 1 - d);
  }
  return b;
}

/**
 * Groceries pop up one after another and drop into a basket, then the basket empties and it
 * starts again (owner, 2026-10-24: "something pop-up / moving"). Decorative: hidden from screen readers.
 */
export function BasketPopArt({ scale = 1, style }: { scale?: number; style?: StyleProp<ViewStyle> }) {
  const t = useLoop(LOOP_MS, REST);
  const basketA = useAnimatedStyle(() => {
    const b = landBump(t.value);
    return { transform: [{ translateY: 2 * b }, { scaleX: 1 + 0.035 * b }, { scaleY: 1 - 0.05 * b }] };
  });
  const shadowA = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 + 0.08 * landBump(t.value) }] }));
  const sparkA = useAnimatedStyle(() => {
    // a soft glint after the last item lands
    const v = t.value, s = LANDS[LANDS.length - 1] + 0.02;
    const p = v < s || v > s + 0.12 ? 0 : (v - s) / 0.12;
    return { opacity: p === 0 ? 0 : Math.sin(p * Math.PI), transform: [{ scale: 0.6 + 0.6 * p }, { rotate: `${p * 90}deg` }] };
  });
  return (
    <View
      style={[{ width: ART_W * scale, height: ART_H * scale }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={{ width: ART_W, height: ART_H, transform: [{ scale }], transformOrigin: 'top left' }}>
        <Animated.View style={[st.shadow, shadowA]} />
        {/* the basket's back wall, behind the groceries */}
        <Animated.View style={[st.basket, basketA]}>
          <Svg width={ART_W} height={ART_H} viewBox={`0 0 ${ART_W} ${ART_H}`}>
            <Path d="M40 64 Q75 18 110 64" stroke="#D9893B" strokeWidth={5} fill="none" strokeLinecap="round" />
            <Ellipse cx={75} cy={66} rx={52} ry={9} fill="#9A5B26" />
          </Svg>
        </Animated.View>
        {ITEMS.map((it) => <Grocery key={it.glyph} t={t} item={it} />)}
        {/* the front, over the groceries' lower half */}
        <Animated.View style={[st.basket, basketA]}>
          <Svg width={ART_W} height={ART_H} viewBox={`0 0 ${ART_W} ${ART_H}`}>
            <Path d="M23 66 L127 66 L115 108 Q113 113 107 113 L43 113 Q37 113 35 108 Z" fill="#ECB06A" />
            <Path d="M30 80 L120 80 M34 94 L116 94" stroke="#C47F3E" strokeWidth={2.2} strokeLinecap="round" />
            <Path d="M52 70 L56 110 M75 70 L75 111 M98 70 L94 110" stroke="#C47F3E" strokeWidth={2.2} strokeLinecap="round" />
            <Path d="M21 64 Q75 72 129 64 L129 69 Q75 77 21 69 Z" fill="#F6CB8C" />
          </Svg>
        </Animated.View>
        <Animated.View style={[st.spark, sparkA]}>
          <Svg width={18} height={18} viewBox="0 0 18 18">
            <Path d="M9 0 L10.6 7.4 L18 9 L10.6 10.6 L9 18 L7.4 10.6 L0 9 L7.4 7.4 Z" fill={C.brandText} />
          </Svg>
        </Animated.View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- the rail's loop icon */

/** Two arrows chasing round: turns once every few seconds (still with reduced motion). */
export function LoopIcon({ size = 16, color = C.brandInk }: { size?: number; color?: string }) {
  const reduced = useReducedMotion();
  const active = useActive();
  const r = useSharedValue(0);
  useEffect(() => {
    if (reduced || !active) { cancelAnimation(r); r.value = 0; return; }
    r.value = 0;
    r.value = withRepeat(withSequence(
      withDelay(1400, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) })),
      withTiming(1, { duration: 2600 }),
      withTiming(0, { duration: 0 }),
    ), -1, false);
    return () => cancelAnimation(r);
  }, [reduced, active, r]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return (
    <Animated.View style={a}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M20 11a8 8 0 0 0-14.3-4.9M4 13a8 8 0 0 0 14.3 4.9" stroke={color} strokeWidth={2.3} strokeLinecap="round" />
        <Path d="M5 2.8v3.7h3.7M19 21.2v-3.7h-3.7" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- success */

/** The tick that springs in when a repeat basket is set, with a ring that pulses out once. */
export function SuccessTick({ size = 76 }: { size?: number }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(reduced ? 1 : 0);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    s.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 180 }));
    ring.value = withDelay(220, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
  }, [reduced, s, ring]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: Math.min(1, s.value * 1.5) }));
  const ringA = useAnimatedStyle(() => ({ opacity: ring.value > 0 ? 0.5 * (1 - ring.value) : 0, transform: [{ scale: 1 + ring.value * 0.7 }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size, backgroundColor: C.brand }, ringA]} />
      <Animated.View style={a}>
        <Svg width={size} height={size} viewBox="0 0 76 76">
          <Circle cx={38} cy={38} r={36} fill={C.brand} />
          <Path d="M23 39.5 L33.5 50 L54 28" stroke={C.brandInk} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  item: { position: 'absolute', top: 0, width: ITEM, height: ITEM, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 29, lineHeight: 34 },
  basket: { position: 'absolute', left: 0, top: 0 },
  shadow: { position: 'absolute', left: 38, top: 110, width: 74, height: 8, borderRadius: 8, backgroundColor: 'rgba(26,29,46,0.10)' },
  spark: { position: 'absolute', left: 118, top: 30 },
});
