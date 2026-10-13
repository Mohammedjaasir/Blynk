import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient as SvgGrad, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { cutout } from '@/blynk/lib/cutout';
import { formatLkr } from '@/blynk/lib/money';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import { ArrowRight } from './icons';
import { PressScale } from './ui';

/*
 * Rebuilt frame by frame from the reference recording (0:06–0:16, 384 px wide ≈ 1:1 with a
 * 390 pt phone). Layout, sizes and timings are measured off those frames; the reference's
 * purple becomes Blynk ink, its pink extrusion / saucer becomes Blynk green, yellow stays.
 */
const H = 152; // banner height in the reference
const EXTRUDE = C.green; // the 3D slab under the title letters and the CTA
const ITEM = 112; // floating product box (the sandwich is ~120 × 110 in the frames)
const TEXT_W = 196; // left column, clear of the beam

/** One title word: per-letter face + green slab, each letter rocking on its own phase. */
function WobbleWord({ word, color, delay }: { word: string; color: string; delay: number }) {
  // Bowlby One averages ~0.82 em per capital; fit the word into the left column.
  const size = Math.min(32, Math.floor(TEXT_W / (word.length * 0.82)));
  return (
    <View style={{ flexDirection: 'row' }}>
      {word.split('').map((ch, i) => (
        <WobbleLetter key={i} ch={ch} color={color} size={size} delay={delay + i * 70} />
      ))}
    </View>
  );
}
function WobbleLetter({ ch, color, size, delay }: { ch: string; color: string; size: number; delay: number }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
          withTiming(-0.6, { duration: 200 }),
          withTiming(0, { duration: 200 }),
          withTiming(0, { duration: 2400 }),
        ),
        -1,
      ),
    );
  }, []);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.abs(r.value) * 3 }, { rotate: `${r.value * 9}deg` }],
  }));
  const t = { fontSize: size, lineHeight: Math.round(size * 1.08) };
  return (
    <Animated.View style={[{ marginRight: -1 }, a]}>
      <Text style={[styles.title, t, styles.slab]}>{ch}</Text>
      <Text style={[styles.title, t, { color }]}>{ch}</Text>
    </Animated.View>
  );
}

/** Four-point star that blinks in, turns and goes out. */
function Sparkle({ x, y, delay, size = 12, color = C.yellow }: { x: number; y: number; delay: number; size?: number; color?: string }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 280 }), withTiming(0, { duration: 420 }), withTiming(0, { duration: 1500 })), -1));
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: 0.4 + s.value * 0.6 }, { rotate: `${s.value * 45}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y }, a]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z" fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** The saucer from the frames: dome, wide tilted brim, glowing strip underneath. */
function Saucer() {
  return (
    <Svg width={96} height={58} viewBox="0 0 96 58">
      <Defs>
        <SvgGrad id="dome" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3FCB5F" />
          <Stop offset="1" stopColor={C.green} />
        </SvgGrad>
        <SvgGrad id="brim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2DB24C" />
          <Stop offset="1" stopColor="#0A6B19" />
        </SvgGrad>
      </Defs>
      <Path d="M24 30 C24 10 36 2 48 2 C60 2 72 10 72 30 Z" fill="url(#dome)" />
      <Path d="M34 14 C38 8 43 6 48 6" stroke="#fff" strokeOpacity={0.7} strokeWidth={3} strokeLinecap="round" fill="none" />
      <Ellipse cx={48} cy={34} rx={46} ry={15} fill="url(#brim)" />
      <Ellipse cx={48} cy={36} rx={36} ry={9} fill="#11131D" />
      <Ellipse cx={48} cy={38} rx={20} ry={4.5} fill={C.yellow} />
      <Ellipse cx={48} cy={38} rx={12} ry={2.5} fill="#FFFBE0" />
    </Svg>
  );
}

/** Rolls between the two facts the reference's single sub-line has room for. */
function useRoll(lines: string[]) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, [lines.length]);
  return lines.length ? lines[i % lines.length] : null;
}

function SubLine({ text, accent }: { text: string; accent: string | null }) {
  const v = useSharedValue(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    v.value = 0;
    v.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    sweep.value = 0;
    sweep.value = withDelay(350, withSequence(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }), withDelay(500, withTiming(2, { duration: 300 }))));
  }, [text]);
  const a = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 10 }] }));
  const u = useAnimatedStyle(() => ({
    opacity: sweep.value > 1 ? 2 - sweep.value : 1,
    transform: [{ scaleX: Math.min(1, sweep.value) }],
  }));
  const parts = accent ? text.split(accent) : [text];
  return (
    <Animated.View style={[{ marginTop: 6, alignSelf: 'flex-start' }, a]}>
      <Text style={styles.sub} numberOfLines={1}>
        {parts[0]}
        {accent && <Text style={{ color: C.yellow }}>{accent}</Text>}
        {parts[1]}
      </Text>
      <Animated.View style={[styles.underline, u]} />
    </Animated.View>
  );
}

/**
 * Home's hero. "FREE / DELIVERY" while Blynk's new-customer free deliveries are on
 * (otherwise "FRESH / GROCERIES"); the sub-line rolls between the free-delivery terms and
 * "Groceries from" the cheapest effective price. The beam abducts real product photos,
 * cut out of their backgrounds on the fly.
 */
export function Banner({ images, minPrice, freeCount, onOrderNow }: {
  images: string[]; minPrice: number | null; freeCount: number; onOrderNow?: () => void;
}) {
  const items = useCutouts(images);
  const [idx, setIdx] = useState(0);
  const ufo = useSharedValue(0);
  const beam = useSharedValue(0);
  const item = useSharedValue(1); // 1 = floating in the beam, 0 = inside the saucer
  const nudge = useSharedValue(0);

  const price = minPrice != null ? formatLkr(minPrice) : null;
  const lines = useMemo(() => {
    const l: string[] = [];
    if (freeCount > 0) l.push(`On your first ${freeCount} order${freeCount > 1 ? 's' : ''}`);
    if (price) l.push(`Groceries starting at ${price}`);
    return l;
  }, [freeCount, price]);
  const line = useRoll(lines);

  const next = () => setIdx((i) => i + 1);
  useEffect(() => {
    ufo.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true);
    beam.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
    nudge.value = withRepeat(withSequence(withTiming(4, { duration: 280 }), withTiming(0, { duration: 280 }), withTiming(0, { duration: 1000 })), -1);
  }, []);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      // pulled up the beam into the saucer, swapped, the next one lowered back down
      item.value = withTiming(0, { duration: 560, easing: Easing.in(Easing.cubic) }, (done) => {
        if (!done) return;
        scheduleOnRN(next);
        item.value = withDelay(120, withSpring(1, { damping: 11, stiffness: 110 }));
      });
    }, 3000);
    return () => clearInterval(t);
  }, [items.length]);

  const ufoA = useAnimatedStyle(() => ({ transform: [{ translateY: ufo.value * 5 }, { rotate: `${16 + ufo.value * 4}deg` }] }));
  const beamA = useAnimatedStyle(() => ({ opacity: (0.55 + beam.value * 0.25) * (0.35 + item.value * 0.65) }));
  const itemA = useAnimatedStyle(() => ({
    opacity: interpolate(item.value, [0, 0.25, 1], [0, 1, 1]),
    transform: [
      { translateX: interpolate(item.value, [0, 1], [34, 0]) },
      { translateY: interpolate(item.value, [0, 1], [-88, 0]) + (1 - ufo.value) * 3 },
      { scale: interpolate(item.value, [0, 1], [0.12, 1]) },
      { rotate: `${interpolate(item.value, [0, 1], [-30, -6])}deg` },
    ],
  }));
  const arrowA = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

  const free = freeCount > 0;
  const cur = items.length ? items[idx % items.length] : null;

  return (
    <View style={styles.wrap}>
      <LinearGradient colors={['#1F2338', C.purple, '#14162A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* soft glow behind the beam, as in the reference */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="glow" cx="72%" cy="62%" rx="38%" ry="70%">
            <Stop offset="0" stopColor="#3A4170" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#3A4170" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
      </Svg>

      <Sparkle x={214} y={26} delay={200} size={6} color="#fff" />
      <Sparkle x={168} y={130} delay={900} size={7} color="#fff" />

      <View style={styles.copy}>
        <WobbleWord key={free ? 'free' : 'fresh'} word={free ? 'FREE' : 'FRESH'} color="#fff" delay={0} />
        <View style={{ marginTop: -4 }}>
          <WobbleWord key={free ? 'del' : 'groc'} word={free ? 'DELIVERY' : 'GROCERIES'} color={C.yellow} delay={380} />
        </View>
        {line && <SubLine key={line} text={line} accent={line.includes(price ?? '\u0000') ? price : null} />}
        <PressScale style={styles.ctaWrap} haptic onPress={onOrderNow}>
          <View style={styles.ctaSlab} />
          <View style={styles.cta}>
            <Text style={styles.ctaTxt}>ORDER NOW</Text>
            <Animated.View style={arrowA}>
              <ArrowRight size={13} color={C.ink} />
            </Animated.View>
          </View>
        </PressScale>
      </View>

      <View style={styles.stage} pointerEvents="none">
        <Animated.View style={[styles.beam, beamA]}>
          <Svg width={170} height={140}>
            <Defs>
              <SvgGrad id="beam" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#E9ECFF" stopOpacity="0.55" />
                <Stop offset="0.6" stopColor="#C9CEF0" stopOpacity="0.2" />
                <Stop offset="1" stopColor="#C9CEF0" stopOpacity="0" />
              </SvgGrad>
            </Defs>
            <Polygon points="118,0 146,0 150,140 8,140" fill="url(#beam)" />
          </Svg>
        </Animated.View>
        {cur && (
          <Animated.View style={[styles.item, itemA]}>
            <Image source={{ uri: cur }} resizeMode="contain" style={styles.itemImg} />
          </Animated.View>
        )}
        <Animated.View style={[styles.saucer, ufoA]}>
          <Saucer />
        </Animated.View>
        <Sparkle x={128} y={96} delay={1400} size={13} />
        <Sparkle x={10} y={40} delay={600} size={9} />
      </View>
    </View>
  );
}

/** Cut-outs of the banner photos that have a plain background, in catalogue order. */
function useCutouts(images: string[]) {
  const key = images.slice(0, 10).join('|');
  const [out, setOut] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(images.slice(0, 10).map(cutout)).then((r) => {
      if (live) setOut(r.filter((x): x is string => !!x));
    });
    return () => { live = false; };
  }, [key]);
  return out;
}

const styles = StyleSheet.create({
  wrap: { height: H, overflow: 'hidden', flexDirection: 'row' },
  copy: { paddingLeft: 24, paddingTop: 18, width: TEXT_W + 24, zIndex: 2 },
  title: { fontFamily: F.display, color: '#fff', includeFontPadding: false },
  slab: { position: 'absolute', left: 1.5, top: 2.5, color: EXTRUDE },
  sub: { fontFamily: F.bold, color: '#F4F2FA', fontSize: 13.5, letterSpacing: 0.3 },
  underline: { height: 2, borderRadius: 1, backgroundColor: '#fff', opacity: 0.85, marginTop: 1, transformOrigin: 'left' },
  ctaWrap: { marginTop: 10, alignSelf: 'flex-start' },
  ctaSlab: { position: 'absolute', left: 0, right: 0, top: 3, bottom: -3, borderRadius: 16, backgroundColor: EXTRUDE },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.yellow, paddingHorizontal: 15, height: 28, borderRadius: 16,
  },
  ctaTxt: { fontFamily: F.black, fontSize: 12, color: C.ink, letterSpacing: 0.6 },
  stage: { position: 'absolute', right: 0, top: 0, width: 170, height: H },
  beam: { position: 'absolute', right: 0, top: 24 },
  saucer: { position: 'absolute', right: 6, top: -16 },
  item: { position: 'absolute', right: 46, bottom: 4, width: ITEM, height: ITEM, alignItems: 'center', justifyContent: 'center' },
  // web: the reference's soft shadow under the floating product
  itemImg: { width: ITEM, height: ITEM, filter: 'drop-shadow(0px 10px 9px rgba(0,0,0,0.45))' } as object,
});
