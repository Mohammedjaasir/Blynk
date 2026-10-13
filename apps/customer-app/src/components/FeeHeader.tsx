import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeIn, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { COPY } from '@/demo/cart';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Demo: the video's copy. Live: Blynk's one true fee claim (no packaging or platform fee). */
const TXT = DEMO
  ? { pill: COPY.feePill, burst1: COPY.burst1, burst2: COPY.burst2, chef: '🧑‍🍳' }
  : { pill: LIVE.feePill, burst1: LIVE.burst1, burst2: LIVE.burst2, chef: '🛒' };

/*
 * Geometry read off the reference (video 0:48–0:53, 384 px wide, status bar = 44):
 *   back row centre  T+41      pill   T+66 … T+104, x 19 … 367, radius 10
 *   cover (opaque)   0 … T+124 burst  T+1 … T+106, full bleed
 * T is the top safe-area inset.
 */
export const FEE = {
  backCenter: 41,
  pillTop: 66,
  pillH: 38,
  coverH: 124,
  contentTop: 130,
  burstTop: 1,
  burstH: 105,
};

/** Timeline of one burst, in ms from its start (measured at 15 fps from the video). */
const T = {
  sweep: 380,
  l1In: 560, l2In: 780, checkIn: 840, mascotIn: 430,
  s1Out: 1980, zeroIn: 2400, f1In: 2650, f2In: 2800,
  collapse: 4300, collapseDur: 260, pillIn: 4600,
};
const S2 = T.s1Out + 300; // slide two mounts here

/** Ink check box whose tick draws itself in. */
function DrawCheck({ size = 27, delay = 0 }: { size?: number; delay?: number }) {
  const d = useSharedValue(0);
  useEffect(() => {
    d.value = withDelay(delay, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
  }, []);
  const props = useAnimatedProps(() => ({ strokeDashoffset: 24 * (1 - d.value) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Rect x={2} y={2} width={22} height={22} rx={4} stroke={C.brandInk} strokeWidth={2.4} fill="none" />
      <AnimatedPath d="M7 13.5l4 4 9-11" stroke={C.brandInk} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="24" animatedProps={props} />
    </Svg>
  );
}

/** Sun-burst rays behind "₹0" (slide 2). */
function Rays() {
  const n = 14;
  const cx = 62, cy = 54, R = 160;
  const d = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n;
    return `M${cx} ${cy}L${(cx + R * Math.cos(a0)).toFixed(1)} ${(cy + R * Math.sin(a0)).toFixed(1)}L${(cx + R * Math.cos(a1)).toFixed(1)} ${(cy + R * Math.sin(a1)).toFixed(1)}Z`;
  }).join('');
  return (
    <Svg width={300} height={FEE.burstH} style={StyleSheet.absoluteFill}>
      <Path d={d} fill={C.brandDeep} opacity={0.7} />
    </Svg>
  );
}

/** Fades and rises in at `delay`; fades out at `out` when given. */
function Line({ delay, out, children, rise = 12, style }: { delay: number; out?: number; children: ReactNode; rise?: number; style?: object }) {
  const v = useSharedValue(0);
  useEffect(() => {
    const inn = withDelay(delay, withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }));
    v.value = out != null ? withSequence(inn, withDelay(out - delay - 200, withTiming(2, { duration: 160 }))) : inn;
  }, []);
  const a = useAnimatedStyle(() => ({
    opacity: v.value <= 1 ? v.value : 2 - v.value,
    transform: [{ translateY: v.value <= 1 ? (1 - v.value) * rise : 0 }],
  }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** Mascot slot: an emoji stands in for the video's character art (no images by design). */
function Mascot({ emoji, rise }: { emoji: string; rise: boolean }) {
  const y = useSharedValue(rise ? 100 : 0);
  useEffect(() => {
    if (rise) y.value = withDelay(T.mascotIn, withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.Text style={[styles.mascot, a]}>{emoji}</Animated.Text>;
}

/**
 * The cart's yellow fee header. At rest it is the "₹0 Packaging Fee · ₹0 Platform fee" pill
 * under the back row. Each time `burstKey` changes it bursts: a soft-edged yellow sweep wipes
 * in from the right over the back row, slide 1 ("OFFLINE PRICE / MATCH ✓") rises in line by
 * line while the mascot climbs up, slide 2 ("₹0 Packaging fee / Platform fee") follows on
 * sun-burst rays, then the header shrinks back into the pill and the pill text fades back.
 * The opaque cover behind the back row lives here too, so the list scrolls under it.
 * Live mode (DEMO=false) keeps the motion and swaps in true copy only: "No packaging fee ·
 * No platform fee"; the video's "OFFLINE PRICE MATCH" claim is never shown.
 */
export function FeeHeader({ topInset, burstKey, backRow }: { topInset: number; burstKey: number; backRow: ReactNode }) {
  const { width } = useWindowDimensions();
  const sweep = useSharedValue(0);
  const shrink = useSharedValue(0);
  const pillTxt = useSharedValue(1);
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 rest, 1 slide one, 2 slide two

  useEffect(() => {
    if (!burstKey) return;
    shrink.value = 0;
    sweep.value = 0;
    pillTxt.value = withTiming(0, { duration: 150 });
    sweep.value = withTiming(1, { duration: T.sweep, easing: Easing.out(Easing.quad) });
    const s1 = setTimeout(() => setPhase(1), 0);
    const a = setTimeout(() => setPhase(2), S2);
    const b = setTimeout(() => {
      shrink.value = withTiming(1, { duration: T.collapseDur, easing: Easing.inOut(Easing.quad) });
    }, T.collapse);
    const c = setTimeout(() => {
      setPhase(0);
      sweep.value = 0;
      shrink.value = 0;
      pillTxt.value = withTiming(1, { duration: 200 });
    }, T.pillIn);
    return () => { clearTimeout(s1); clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, [burstKey]);

  const pillTop = topInset + FEE.pillTop;
  const burstTop = topInset + FEE.burstTop;
  const cover = useAnimatedStyle(() => ({
    height: interpolate(sweep.value * (1 - shrink.value), [0, 1], [topInset + FEE.coverH, burstTop + FEE.burstH]),
  }));
  // the burst panel: full bleed while out, shrinks into the pill geometry on collapse
  const panel = useAnimatedStyle(() => ({
    opacity: sweep.value > 0 ? 1 : 0,
    top: interpolate(shrink.value, [0, 1], [burstTop, pillTop]),
    height: interpolate(shrink.value, [0, 1], [FEE.burstH, FEE.pillH]),
    left: interpolate(shrink.value, [0, 1], [0, 19]),
    right: interpolate(shrink.value, [0, 1], [0, 17]),
    borderRadius: interpolate(shrink.value, [0, 1], [0, 10]),
  }));
  // a band (soft diagonal gradient edge, then solid yellow) sliding right → left
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(sweep.value, [0, 1], [width, -220]) }] }));
  const content = useAnimatedStyle(() => ({ opacity: 1 - shrink.value, transform: [{ scale: 1 - shrink.value * 0.35 }] }));
  const pillA = useAnimatedStyle(() => ({ opacity: pillTxt.value }));

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.cover, cover]} />
      <View style={[styles.back, { top: topInset + FEE.backCenter - 19 }]}>{backRow}</View>

      {/* resting pill */}
      <View pointerEvents="none" style={[styles.pill, { top: pillTop }]}>
        <Animated.View style={[styles.pillRow, pillA]}>
          <Text style={styles.pillTxt} numberOfLines={1}>{TXT.pill}</Text>
        </Animated.View>
        <Text style={styles.pillMascot}>👍</Text>
      </View>

      {/* burst */}
      <Animated.View pointerEvents="none" style={[styles.panel, panel]}>
        <Animated.View style={[styles.band, { width: width + 220 }, band]}>
          <LinearGradient colors={['rgba(255,225,65,0)', C.brand]} start={{ x: 0, y: 0.1 }} end={{ x: 1, y: 0.9 }} style={{ width: 220, height: '100%' }} />
          <View style={{ flex: 1, backgroundColor: C.brand }} />
        </Animated.View>
        {phase !== 0 && (
          <Animated.View key={burstKey} style={[StyleSheet.absoluteFill, content]}>
            {phase === 1 ? (
              <View style={styles.s1}>
                <Line delay={T.l1In} out={T.s1Out}><Text style={styles.big}>{TXT.burst1[0]}</Text></Line>
                <Line delay={T.l2In} out={T.s1Out + 150} style={styles.row}>
                  <Text style={styles.big}>{TXT.burst1[1]}</Text>
                  <DrawCheck delay={T.checkIn} />
                </Line>
              </View>
            ) : (
              <View style={StyleSheet.absoluteFill}>
                <Animated.View entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill}><Rays /></Animated.View>
                <View style={styles.s2}>
                  <Line delay={T.zeroIn - S2} rise={14}><Text style={styles.zero}>{TXT.burst2.big}</Text></Line>
                  <View>
                    <Line delay={T.f1In - S2}><Text style={styles.feeLine}>{TXT.burst2.lines[0]}</Text></Line>
                    <Line delay={T.f2In - S2}><Text style={styles.feeLine}>{TXT.burst2.lines[1]}</Text></Line>
                  </View>
                </View>
              </View>
            )}
            <Mascot key={phase} emoji={phase === 1 ? TXT.chef : '👍'} rise={phase === 1} />
          </Animated.View>
        )}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: C.bg, zIndex: 4 },
  back: { position: 'absolute', left: 0, right: 0, height: 38, zIndex: 5 },
  pill: { position: 'absolute', left: 19, right: 17, height: FEE.pillH, borderRadius: 10, backgroundColor: C.brand, zIndex: 6 },
  pillRow: { ...StyleSheet.absoluteFill, justifyContent: 'center', paddingLeft: 36, paddingRight: 50 },
  pillTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14.5, letterSpacing: -0.1 },
  pillMascot: { position: 'absolute', right: 10, bottom: -4, fontSize: 40, lineHeight: 52 },
  panel: { position: 'absolute', overflow: 'hidden', zIndex: 20 },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  s1: { position: 'absolute', left: 28, top: 22 },
  big: { fontFamily: F.condensed, fontSize: 29, color: C.brandInk, lineHeight: 33, letterSpacing: 0.2 },
  s2: { position: 'absolute', left: 33, top: 17, flexDirection: 'row', alignItems: 'center', gap: 10 },
  zero: { fontFamily: F.condensed, fontSize: 60, color: C.brandInk, lineHeight: 72 },
  feeLine: { fontFamily: F.medium, fontSize: 19, color: C.brandInk, lineHeight: 27 },
  mascot: { position: 'absolute', right: 24, bottom: -12, fontSize: 74, lineHeight: 98 },
});
