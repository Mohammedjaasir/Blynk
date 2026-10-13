import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeInRight, FadeOut, interpolate, SharedValue, useAnimatedProps, useAnimatedReaction,
  useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { C, F } from '@/lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Check box whose tick draws itself in. */
function DrawCheck({ size = 26, delay = 0 }: { size?: number; delay?: number }) {
  const d = useSharedValue(0);
  useEffect(() => {
    d.value = withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, []);
  const props = useAnimatedProps(() => ({ strokeDashoffset: 24 * (1 - d.value) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Rect x={2} y={2} width={22} height={22} rx={4} stroke={C.yellow} strokeWidth={2.4} fill="none" />
      <AnimatedPath d="M7 13.5l4 4 8-9" stroke={C.yellow} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="24" animatedProps={props} />
    </Svg>
  );
}

/**
 * The cart's green fee banner. At rest it is a rounded pill under the back row;
 * once you scroll it bursts out to a full-bleed header (a light sweep wipes
 * across), then cycles two slides: "MANDI PRICE MATCH ✓" and "₹0 Packaging /
 * Platform fee", each line rising in on a stagger while the mascot slides in.
 */
export function FeeHeader({ scrollY, topInset, backRowH }: { scrollY: SharedValue<number>; topInset: number; backRowH: number }) {
  const { width } = useWindowDimensions();
  const ex = useSharedValue(0);
  const wipe = useSharedValue(0);
  const [expanded, setExpanded] = useState(false);
  const [slide, setSlide] = useState(0);
  const onExpand = (v: boolean) => {
    setExpanded(v);
    setSlide(0);
  };

  useAnimatedReaction(
    () => scrollY.value > 30,
    (s, p) => {
      if (s === p) return;
      ex.value = withTiming(s ? 1 : 0, { duration: 380, easing: Easing.bezier(0.2, 0.9, 0.2, 1) });
      if (s) {
        wipe.value = 0;
        wipe.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.quad) });
      }
      scheduleOnRN(onExpand, s);
    },
  );

  useEffect(() => {
    if (!expanded) return;
    const t = setInterval(() => setSlide((x) => (x + 1) % 2), 2800);
    return () => clearInterval(t);
  }, [expanded]);

  const collapsedTop = topInset + backRowH;
  const box = useAnimatedStyle(() => ({
    top: interpolate(ex.value, [0, 1], [collapsedTop, 0]),
    left: interpolate(ex.value, [0, 1], [16, 0]),
    right: interpolate(ex.value, [0, 1], [16, 0]),
    height: interpolate(ex.value, [0, 1], [40, topInset + 78]),
    borderRadius: interpolate(ex.value, [0, 1], [12, 0]),
  }));
  const pillA = useAnimatedStyle(() => ({ opacity: 1 - ex.value * 2 }));
  const wipeA = useAnimatedStyle(() => ({
    opacity: interpolate(wipe.value, [0, 0.1, 0.8, 1], [0, 0.9, 0.9, 0]),
    transform: [{ translateX: interpolate(wipe.value, [0, 1], [width, -width * 0.6]) }, { skewX: '-20deg' }],
  }));

  return (
    <Animated.View style={[styles.box, box]} pointerEvents="none">
      <Animated.View style={[styles.wipe, wipeA]} />
      {/* collapsed pill content */}
      <Animated.View style={[styles.pill, pillA]}>
        <Text style={styles.pillTxt}>₹0 Packaging Fee  ·  ₹0 Platform fee</Text>
        <Text style={styles.pillMascot}>🧑‍🌾</Text>
      </Animated.View>

      {expanded && (
        <View style={[styles.full, { paddingTop: topInset }]}>
          {slide === 0 ? (
            <Animated.View key="s0" exiting={FadeOut.duration(200)} style={styles.slide}>
              <View>
                <Animated.Text entering={FadeInDown.delay(250).duration(380)} style={styles.big}>MANDI PRICE</Animated.Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Animated.Text entering={FadeInDown.delay(420).duration(380)} style={styles.big}>MATCH</Animated.Text>
                  <Animated.View entering={FadeIn.delay(520)}>
                    <DrawCheck delay={560} />
                  </Animated.View>
                </View>
              </View>
              <Animated.Text entering={FadeInRight.delay(300).springify().mass(1).energyThreshold(1e-4).damping(12)} style={styles.mascot}>🧑‍🌾</Animated.Text>
            </Animated.View>
          ) : (
            <Animated.View key="s1" exiting={FadeOut.duration(200)} style={styles.slide}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Animated.Text entering={FadeInDown.springify().mass(1).energyThreshold(1e-4).damping(11)} style={styles.zero}>₹0</Animated.Text>
                <View>
                  <Animated.Text entering={FadeInDown.delay(180).duration(350)} style={styles.feeLine}>Packaging fee</Animated.Text>
                  <Animated.Text entering={FadeInDown.delay(330).duration(350)} style={styles.feeLine}>Platform fee</Animated.Text>
                </View>
              </View>
              <Animated.Text entering={FadeInRight.delay(150).springify().mass(1).energyThreshold(1e-4).damping(12)} style={styles.mascot}>👍</Animated.Text>
            </Animated.View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', backgroundColor: C.green, overflow: 'hidden', zIndex: 20 },
  wipe: { position: 'absolute', top: -20, bottom: -20, width: 160, backgroundColor: '#3DDC63' },
  pill: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pillTxt: { color: C.yellow, fontFamily: F.bold, fontSize: 13 },
  pillMascot: { position: 'absolute', right: 6, bottom: -6, fontSize: 30 },
  full: { ...StyleSheet.absoluteFill },
  slide: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  big: { fontFamily: F.condensed, fontSize: 26, color: C.yellow, lineHeight: 30, letterSpacing: 0.5 },
  zero: { fontFamily: F.condensed, fontSize: 48, color: C.yellow, lineHeight: 56 },
  feeLine: { fontFamily: F.semi, fontSize: 17, color: C.yellow, lineHeight: 21 },
  mascot: { fontSize: 54, marginBottom: -10 },
});
