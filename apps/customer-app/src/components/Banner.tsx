import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import Svg, { Defs, LinearGradient as SvgGrad, Polygon, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { formatLkr } from '@/blynk/lib/money';
import { C, F } from '@/lib/theme';
import { ArrowRight } from './icons';
import { PressScale } from './ui';

/** Shown in the beam only until real product photos arrive. */
const FALLBACK = ['🥦', '🍞', '🥛', '🍌'];

/** Each title letter rocks on its own phase — the jelly wobble. */
function WobbleWord({ word, delay }: { word: string; delay: number }) {
  // long words (DELIVERY, GROCERIES) step down so they fit beside the UFO
  const size = word.length > 5 ? 25 : 34;
  return (
    <View style={{ flexDirection: 'row' }}>
      {word.split('').map((ch, i) => (
        <WobbleLetter key={i} ch={ch} delay={delay + i * 90} size={size} />
      ))}
    </View>
  );
}
function WobbleLetter({ ch, delay, size }: { ch: string; delay: number; size: number }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 260 }), withTiming(-1, { duration: 260 }), withTiming(0, { duration: 220 }), withTiming(0, { duration: 2200 })), -1),
    );
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 7}deg` }, { translateY: Math.abs(r.value) * -2 }] }));
  return <Animated.Text style={[styles.title, { fontSize: size, lineHeight: Math.round(size * 1.3) }, a]}>{ch}</Animated.Text>;
}

/** A ✦ that blinks in, spins and vanishes. */
function Sparkle({ x, y, delay, size = 12 }: { x: number; y: number; delay: number; size?: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 300 }), withTiming(0, { duration: 400 }), withTiming(0, { duration: 1300 })), -1));
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: s.value }, { rotate: `${s.value * 90}deg` }] }));
  return <Animated.Text style={[{ position: 'absolute', left: x, top: y, fontSize: size, color: C.yellow }, a]}>✦</Animated.Text>;
}

/**
 * Home's hero. "FREE DELIVERY / on your first N orders" while Blynk's free deliveries
 * are on (otherwise "FRESH GROCERIES"), "Groceries starting at" the cheapest effective
 * price in the catalogue, and the UFO beam abducts real product photos.
 */
export function Banner({ images, minPrice, freeCount, onOrderNow }: {
  images: string[]; minPrice: number | null; freeCount: number; onOrderNow?: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const count = images.length || FALLBACK.length;
  const ufo = useSharedValue(0);
  const beam = useSharedValue(0.6);
  const item = useSharedValue(1); // 1 = resting on ground, 0 = inside the UFO
  const nudge = useSharedValue(0);

  const next = () => setIdx((i) => i + 1);

  useEffect(() => {
    ufo.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    beam.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
    nudge.value = withRepeat(withSequence(withTiming(4, { duration: 300 }), withTiming(0, { duration: 300 }), withTiming(0, { duration: 900 })), -1);
    const t = setInterval(() => {
      // beam the current item up, swap it, drop the next one down
      item.value = withTiming(0, { duration: 520, easing: Easing.in(Easing.cubic) }, (done) => {
        if (!done) return;
        scheduleOnRN(next);
        item.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 120 }));
      });
    }, 2800);
    return () => clearInterval(t);
  }, []);

  const ufoA = useAnimatedStyle(() => ({ transform: [{ translateY: ufo.value * 6 }, { rotate: `${-8 + ufo.value * 6}deg` }] }));
  const beamA = useAnimatedStyle(() => ({ opacity: 0.35 + beam.value * 0.35 * (0.5 + item.value * 0.5) }));
  const itemA = useAnimatedStyle(() => ({
    opacity: interpolate(item.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [
      { translateY: interpolate(item.value, [0, 1], [-62, 0]) },
      { scale: interpolate(item.value, [0, 1], [0.15, 1]) },
      { rotate: `${(1 - item.value) * 160}deg` },
    ],
  }));
  const arrowA = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

  return (
    <LinearGradient colors={[C.purple, C.purpleLight, '#11131D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.wrap}>
      {/* starfield */}
      <Sparkle x={150} y={18} delay={0} size={8} />
      <Sparkle x={330} y={120} delay={700} size={9} />
      <Sparkle x={205} y={136} delay={1200} size={7} />

      <View style={{ flex: 1 }}>
        <WobbleWord key={freeCount > 0 ? 'free' : 'fresh'} word={freeCount > 0 ? 'FREE' : 'FRESH'} delay={0} />
        <View style={{ marginTop: -10 }}>
          <WobbleWord key={freeCount > 0 ? 'del' : 'groc'} word={freeCount > 0 ? 'DELIVERY' : 'GROCERIES'} delay={450} />
        </View>
        {freeCount > 0 && (
          <Text style={styles.sub}>on your first {freeCount} order{freeCount > 1 ? 's' : ''}</Text>
        )}
        {minPrice != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <Text style={styles.sub}>Groceries starting at </Text>
            <View>
              <Text style={[styles.sub, { color: C.yellow, fontSize: 15 }]}>{formatLkr(minPrice)}</Text>
              <Sparkle x={-6} y={-8} delay={300} size={10} />
              <Sparkle x={18} y={-4} delay={900} size={8} />
              <Sparkle x={14} y={14} delay={1500} size={7} />
            </View>
          </View>
        )}
        <PressScale style={styles.cta} haptic onPress={onOrderNow}>
          <Text style={styles.ctaTxt}>ORDER NOW</Text>
          <Animated.View style={arrowA}>
            <ArrowRight size={12} color={C.ink} />
          </Animated.View>
        </PressScale>
      </View>

      <View style={styles.stage}>
        <Animated.View renderToHardwareTextureAndroid style={[styles.beam, beamA]}>
          <Svg width={120} height={110}>
            <Defs>
              <SvgGrad id="b" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.yellow} stopOpacity="0.95" />
                <Stop offset="1" stopColor="#FFF8D6" stopOpacity="0.15" />
              </SvgGrad>
            </Defs>
            <Polygon points="48,0 72,0 120,110 0,110" fill="url(#b)" />
          </Svg>
        </Animated.View>
        <Animated.Text style={[styles.ufo, ufoA]}>🛸</Animated.Text>
        {images.length > 0 ? (
          <Animated.View style={[styles.itemImgWrap, itemA]}>
            <Image source={{ uri: images[idx % count] }} resizeMode="contain" style={styles.itemImg} />
          </Animated.View>
        ) : (
          <Animated.Text style={[styles.item, itemA]}>{FALLBACK[idx % count]}</Animated.Text>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, overflow: 'hidden' },
  title: {
    fontFamily: F.display, fontSize: 34, color: C.yellow, lineHeight: 44,
    textShadowColor: '#fff', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0,
  },
  sub: { fontFamily: F.bold, color: '#fff', fontSize: 13 },
  cta: {
    marginTop: 12, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.yellow, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  ctaTxt: { fontFamily: F.black, fontSize: 11.5, color: C.ink, letterSpacing: 0.5 },
  stage: { width: 140, height: 150, alignItems: 'center' },
  ufo: { fontSize: 50, position: 'absolute', top: -2, right: 20 },
  beam: { position: 'absolute', top: 36, right: 12 },
  item: { position: 'absolute', bottom: 2, right: 34, fontSize: 64 },
  itemImgWrap: { position: 'absolute', bottom: 2, right: 26, width: 82, height: 82, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  itemImg: { width: 70, height: 70 },
});
