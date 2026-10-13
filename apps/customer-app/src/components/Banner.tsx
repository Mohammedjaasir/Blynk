import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, SharedValue, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient as SvgGrad, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { cutout } from '@/blynk/lib/cutout';
import { formatLkr } from '@/blynk/lib/money';
import { withSpring } from '@/lib/motion';
import { F } from '@/lib/theme';
import { ArrowRight } from './icons';
import { PressScale } from './ui';

/*
 * The "BROKE HOURS" promo, rebuilt frame by frame from the reference recording (0:05–0:17,
 * 384 px wide ≈ 1:1 with a 390 pt phone). Owner's call (2026-10-13): this banner keeps the
 * reference's own purple / pink / yellow, unlike the rest of the app.
 *
 * One cycle per dish (the video: sandwich 11.0 → 13.4 s, noodles 13.4 → 15.5 s, burger …):
 *   0 ms     dish is lowered down the beam from the saucer and springs into place
 *   300 ms   gradient underline sweeps under the sub-line
 *   550 ms   firework burst around the price
 *   1100 ms  the title letters jump one after another (and, every other dish, the moon pops in)
 *   P−380 ms dish is sucked back up the beam while the saucer swings, then the next one drops
 */
const H = 183;
const ITEM = 86;
const TEXT_W = 196;
const P = 2600; // ms per dish

/** The banner's top purple. Home paints its header the same, so header and banner read as one block, as in the reference. */
export const BANNER_TOP = '#2E0C66';

/** Reference palette, sampled off the frames. */
const V = {
  bg: ['#2E0C66', '#300C6C', '#3A1380'] as const,
  glow: '#6A3AA8',
  cloud: '#250854',
  pink: '#F04FB2',
  pinkDeep: '#C41E86',
  extrude: '#E8279A',
  rimDark: '#3A0B48',
  lime: '#CBEB6B',
  limeDeep: '#8FC23A',
  yellow: '#FFE81F',
  ctaText: '#1E0B3A',
  white: '#FFFFFF',
};

/** Letter-by-letter jump: a wave travels across the word once per cycle. */
function WaveWord({ word, color, wave, offset, clockO }: {
  word: string; color: string; wave: SharedValue<number>; offset: number; clockO?: boolean;
}) {
  // Bowlby One averages ~0.82 em per capital; fit the word into the left column.
  const size = Math.min(36, Math.floor(TEXT_W / (word.length * 0.82)));
  return (
    <View style={{ flexDirection: 'row' }}>
      {word.split('').map((ch, i) => (
        <WaveLetter key={i} ch={ch} color={color} size={size} wave={wave} at={offset + i} clock={clockO && ch === 'O'} />
      ))}
    </View>
  );
}
function WaveLetter({ ch, color, size, wave, at, clock }: {
  ch: string; color: string; size: number; wave: SharedValue<number>; at: number; clock?: boolean;
}) {
  const a = useAnimatedStyle(() => {
    const p = wave.value * 12 - at * 0.9; // ~70 ms between neighbours
    const bump = p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0;
    return { transform: [{ translateY: -bump * 7 }, { rotate: `${bump * (at % 2 ? 13 : -13)}deg` }] };
  });
  const t = { fontSize: size, lineHeight: Math.round(size * 1.02) };
  return (
    <Animated.View style={[{ marginRight: -1.5 }, a]}>
      <Text style={[styles.title, t, styles.slab]}>{ch}</Text>
      <Text style={[styles.title, t, { color }]}>{ch}</Text>
      {clock && (
        // the clock hands inside the O of HOURS
        <Svg pointerEvents="none" style={{ position: 'absolute', left: size * 0.3, top: size * 0.3 }} width={size * 0.36} height={size * 0.36} viewBox="0 0 12 12">
          <Path d="M6 6 L6 2.2 M6 6 L8.8 7.6" stroke={V.bg[0]} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      )}
    </Animated.View>
  );
}

/** Four-point star that blinks in, turns and goes out. */
function Sparkle({ x, y, delay, size = 12, color = V.yellow, period = 2200 }: { x: number; y: number; delay: number; size?: number; color?: string; period?: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 260 }), withTiming(0, { duration: 380 }), withTiming(0, { duration: period - 640 })), -1));
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: 0.3 + s.value * 0.7 }, { rotate: `${s.value * 45}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y }, a]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z" fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** The saucer: pink dome, thick pink rim, dark underside with a lime light ring. */
function Saucer() {
  return (
    <Svg width={92} height={56} viewBox="0 0 92 56">
      <Defs>
        <SvgGrad id="sDome" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF8AD2" />
          <Stop offset="0.55" stopColor={V.pink} />
          <Stop offset="1" stopColor={V.pinkDeep} />
        </SvgGrad>
        <SvgGrad id="sLime" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2FFB0" />
          <Stop offset="1" stopColor={V.limeDeep} />
        </SvgGrad>
      </Defs>
      <Path d="M12 28 C12 7 30 1 47 1 C64 1 82 7 82 28 Z" fill="url(#sDome)" />
      <Path d="M26 13 C32 7 39 5 46 5" stroke="#fff" strokeOpacity={0.75} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <Ellipse cx={46} cy={31} rx={43} ry={15} fill={V.pink} />
      <Ellipse cx={46} cy={32.5} rx={36} ry={10.5} fill={V.rimDark} />
      <Ellipse cx={46} cy={35} rx={20} ry={6} fill="url(#sLime)" />
      <Ellipse cx={46} cy={34} rx={11} ry={2.6} fill="#FBFFE0" opacity={0.9} />
    </Svg>
  );
}

/** Dark cloud silhouettes along the top edge, drifting slowly. */
function Clouds() {
  const d = useSharedValue(0);
  useEffect(() => {
    d.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -d.value * 14 }] }));
  const cloud = 'M0 18 C2 10 10 8 15 11 C17 4 27 2 31 8 C36 4 44 7 44 13 C50 13 52 18 50 20 L2 20 C0 20 0 19 0 18 Z';
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, a]}>
      <Svg width={420} height={60} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Path d={cloud} fill={V.cloud} transform="translate(210 6) scale(1.1)" />
        <Path d={cloud} fill={V.cloud} transform="translate(300 -2) scale(1.4)" opacity={0.9} />
        <Path d={cloud} fill={V.cloud} transform="translate(372 14) scale(0.9)" />
      </Svg>
    </Animated.View>
  );
}

/** Firework burst around the price: short dashes flying outwards. */
function Firework({ f }: { f: SharedValue<number> }) {
  const colors = ['#8FB8FF', '#FFFFFF', '#FF7ACB', '#8FB8FF', '#FFFFFF', '#FF7ACB', '#8FB8FF', '#FFFFFF', '#FF7ACB', '#FFFFFF'];
  return (
    <View pointerEvents="none" style={styles.fwAnchor}>
      {colors.map((c, i) => <Dash key={i} f={f} angle={(i * 360) / colors.length} color={c} />)}
    </View>
  );
}
function Dash({ f, angle, color }: { f: SharedValue<number>; angle: number; color: string }) {
  const a = useAnimatedStyle(() => ({
    opacity: f.value <= 0 || f.value >= 1 ? 0 : 1 - f.value * f.value,
    transform: [{ rotate: `${angle}deg` }, { translateY: -(7 + f.value * 13) }, { scaleY: 1 - f.value * 0.5 }],
  }));
  return <Animated.View style={[styles.dash, { backgroundColor: color }, a]} />;
}

/** Rolls between the facts the single sub-line has room for (live mode). */
function useRoll(lines: string[]) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = setInterval(() => setI((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, [lines.length]);
  return lines.length ? lines[i % lines.length] : null;
}

/**
 * Home's hero. Design mock: the reference's own copy and emoji dishes. Live: "FREE /
 * DELIVERY" while Blynk's new-customer free deliveries are on (otherwise "FRESH /
 * GROCERIES"), the sub-line rolls between the terms and "Groceries starting at" the
 * cheapest effective price, and the beam abducts real product photos cut out on the fly.
 */
export function Banner({ images, minPrice, freeCount, onOrderNow, demo }: {
  images: string[]; minPrice: number | null; freeCount: number; onOrderNow?: () => void;
  /** Design mock: the reference's own copy, with emoji stand-ins for the abducted dishes. */
  demo?: { title: [string, string]; line: string; accent: string; emojis: string[] };
}) {
  const cutouts = useCutouts(demo ? [] : images);
  const items = demo ? demo.emojis : cutouts;
  const [idx, setIdx] = useState(0);

  const bob = useSharedValue(0);
  const swing = useSharedValue(0);
  const item = useSharedValue(1); // 1 = resting in the beam, 0 = up inside the saucer
  const fire = useSharedValue(0);
  const moon = useSharedValue(0);
  const wave = useSharedValue(0);
  const sweep = useSharedValue(0);
  const nudge = useSharedValue(0);

  const price = minPrice != null ? formatLkr(minPrice) : null;
  const lines = useMemo(() => {
    if (demo) return [demo.line];
    const l: string[] = [];
    if (freeCount > 0) l.push(`On your first ${freeCount} order${freeCount > 1 ? 's' : ''}`);
    if (price) l.push(`Groceries starting at ${price}`);
    return l;
  }, [freeCount, price, demo]);
  const line = useRoll(lines);

  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true);
    nudge.value = withRepeat(withSequence(withTiming(4, { duration: 280 }), withTiming(0, { duration: 280 }), withTiming(0, { duration: 1000 })), -1);
  }, []);

  // One choreographed cycle per dish.
  useEffect(() => {
    const first = idx === 0;
    if (!first) {
      item.value = 0;
      item.value = withSpring(1, { damping: 12, stiffness: 150 });
    }
    sweep.value = 0;
    sweep.value = withDelay(300, withSequence(withTiming(1, { duration: 480, easing: Easing.inOut(Easing.quad) }), withDelay(1500, withTiming(2, { duration: 300 }))));
    fire.value = 0;
    fire.value = withDelay(550, withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }));
    moon.value = 0;
    // the moon only shows up every other dish in the reference
    if (idx % 2 === 1) moon.value = withDelay(1100, withSequence(withSpring(1, { damping: 9, stiffness: 220 }), withDelay(420, withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }))));
    wave.value = 0;
    wave.value = withDelay(1100, withTiming(1, { duration: 1000, easing: Easing.linear }));
    if (items.length < 2) {
      const t = setTimeout(() => setIdx((i) => i + 1), P);
      return () => clearTimeout(t);
    }
    const exit = setTimeout(() => {
      // sucked back up the beam while the saucer swings
      item.value = withTiming(0, { duration: 230, easing: Easing.in(Easing.cubic) });
      swing.value = withSequence(withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 340, easing: Easing.inOut(Easing.quad) }));
    }, P - 380);
    const nextT = setTimeout(() => setIdx((i) => i + 1), P - 120);
    return () => { clearTimeout(exit); clearTimeout(nextT); };
  }, [idx, items.length]);

  const ufoA = useAnimatedStyle(() => ({
    transform: [
      { translateY: bob.value * 4 - 2 },
      { translateX: -swing.value * 6 },
      { rotate: `${14 + bob.value * 5 + swing.value * 16}deg` },
    ],
  }));
  const beamA = useAnimatedStyle(() => ({ opacity: 0.85 + bob.value * 0.15 - swing.value * 0.3 }));
  const itemA = useAnimatedStyle(() => ({
    opacity: item.value < 0.04 ? 0 : 1,
    transform: [
      { translateX: (1 - item.value) * 40 },
      { translateY: (1 - item.value) * -84 + bob.value * 2 },
      { scale: 0.1 + item.value * 0.9 },
      { rotate: `${-4 + (1 - item.value) * 20}deg` },
    ],
  }));
  const moonA = useAnimatedStyle(() => ({ opacity: moon.value > 0.02 ? 1 : 0, transform: [{ scale: moon.value }] }));
  const lineA = useAnimatedStyle(() => ({
    opacity: sweep.value > 1 ? 2 - sweep.value : 1,
    transform: [{ scaleX: Math.min(1, sweep.value) }],
  }));
  const arrowA = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

  const free = freeCount > 0;
  const [w1, w2] = demo ? demo.title : free ? ['FREE', 'DELIVERY'] : ['FRESH', 'GROCERIES'];
  const accent = demo ? demo.accent : price;
  const cur = items.length ? items[idx % items.length] : null;
  const parts = line && accent && line.includes(accent) ? line.split(accent) : null;

  return (
    <View style={styles.wrap}>
      <LinearGradient colors={V.bg} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* the beam lights the ground under the dish */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="bGlow" cx="72%" cy="96%" rx="34%" ry="48%">
            <Stop offset="0" stopColor={V.glow} stopOpacity="0.95" />
            <Stop offset="1" stopColor={V.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bGlow)" />
      </Svg>
      <Clouds />

      <Animated.View pointerEvents="none" style={[styles.moon, moonA]} />
      <Sparkle x={168} y={150} delay={300} size={7} color="#fff" />
      <Sparkle x={214} y={30} delay={1200} size={6} color="#fff" />

      <View style={styles.copy}>
        <WaveWord key={`a${w1}`} word={w1} color={V.white} wave={wave} offset={0} />
        <View style={{ marginTop: -5, marginLeft: -7 }}>
          <WaveWord key={`b${w2}`} word={w2} color={V.yellow} wave={wave} offset={w1.length + 0.6} clockO />
        </View>
        {line && (
          <View style={styles.subWrap}>
            <Text style={styles.sub} numberOfLines={1}>
              {parts ? <>{parts[0]}{accent}{parts[1]}</> : line}
            </Text>
            <Animated.View style={[styles.underline, lineA]}>
              <LinearGradient colors={['#4E73DA', '#9A4FD0', V.extrude]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
            {parts && <Firework f={fire} />}
          </View>
        )}
        <PressScale style={styles.ctaWrap} haptic onPress={onOrderNow}>
          <View style={styles.ctaSlab} />
          <View style={styles.cta}>
            <Text style={styles.ctaTxt}>ORDER NOW</Text>
            <Animated.View style={arrowA}>
              <ArrowRight size={13} color={V.ctaText} />
            </Animated.View>
          </View>
        </PressScale>
      </View>

      <View style={styles.stage} pointerEvents="none">
        <Animated.View style={[styles.beam, beamA]}>
          {/* warm cone straight out of the saucer's light ring, fanning down-left over the item */}
          <Svg width={210} height={H}>
            <Defs>
              <SvgGrad id="bBeam" x1="0.8" y1="0" x2="0.35" y2="1">
                <Stop offset="0" stopColor="#FFE9A6" stopOpacity="1" />
                <Stop offset="0.45" stopColor="#F4C2D6" stopOpacity="0.62" />
                <Stop offset="1" stopColor="#C89DF0" stopOpacity="0.18" />
              </SvgGrad>
              <SvgGrad id="bCore" x1="0.8" y1="0" x2="0.4" y2="1">
                <Stop offset="0" stopColor="#FFFBE6" stopOpacity="0.85" />
                <Stop offset="1" stopColor="#FFE9F4" stopOpacity="0" />
              </SvgGrad>
            </Defs>
            <Polygon points="138,44 172,50 206,183 40,183" fill="url(#bBeam)" />
            <Polygon points="148,46 166,49 170,150 108,150" fill="url(#bCore)" />
          </Svg>
        </Animated.View>
        {cur && (
          <Animated.View style={[styles.item, itemA]}>
            {demo ? (
              <Text style={styles.itemEmoji}>{cur}</Text>
            ) : (
              <Image source={{ uri: cur }} resizeMode="contain" style={styles.itemImg} />
            )}
          </Animated.View>
        )}
        <Animated.View style={[styles.saucer, ufoA]}>
          <Saucer />
        </Animated.View>
        <Sparkle x={150} y={104} delay={1500} size={12} />
        <Sparkle x={22} y={62} delay={800} size={9} />
        <Sparkle x={150} y={40} delay={2000} size={8} />
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
  wrap: { height: H, overflow: 'hidden', flexDirection: 'row', backgroundColor: V.bg[1] },
  copy: { paddingLeft: 24, paddingTop: 26, width: TEXT_W + 24, zIndex: 2 },
  title: { fontFamily: F.display, color: V.white, includeFontPadding: false },
  slab: { position: 'absolute', left: -2.5, top: 3.5, color: V.extrude },
  subWrap: { marginTop: 1, alignSelf: 'flex-start' },
  sub: { fontFamily: F.bold, color: '#FFF4FF', fontSize: 15, letterSpacing: 0.8 },
  underline: { height: 2, borderRadius: 1, marginTop: 2, overflow: 'hidden', transformOrigin: 'left' },
  fwAnchor: { position: 'absolute', right: 12, top: 10, width: 0, height: 0 },
  dash: { position: 'absolute', left: -1, top: -3, width: 2, height: 6, borderRadius: 1 },
  ctaWrap: { marginTop: 12, alignSelf: 'flex-start' },
  ctaSlab: { position: 'absolute', left: -3, right: 3, top: 4, bottom: -4, borderRadius: 16, backgroundColor: V.extrude },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: V.yellow, paddingHorizontal: 13, height: 28, borderRadius: 16,
  },
  ctaTxt: { fontFamily: F.black, fontSize: 12, color: V.ctaText, letterSpacing: 0.6 },
  moon: { position: 'absolute', left: 184, top: 34, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  stage: { position: 'absolute', right: 0, top: 0, width: 180, height: H },
  beam: { position: 'absolute', left: -30, top: 0 },
  saucer: { position: 'absolute', right: 8, top: 12 },
  item: { position: 'absolute', right: 44, bottom: 12, width: ITEM, height: ITEM, alignItems: 'center', justifyContent: 'center' },
  // web: the reference's soft shadow under the floating dish
  itemImg: { width: ITEM, height: ITEM, filter: 'drop-shadow(0px 10px 9px rgba(0,0,0,0.45))' } as object,
  itemEmoji: { fontSize: 74, lineHeight: 88, textAlign: 'center', filter: 'drop-shadow(0px 10px 9px rgba(0,0,0,0.45))' } as object,
});
