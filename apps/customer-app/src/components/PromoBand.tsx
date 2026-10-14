import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Polygon, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import {
  BAND_LAYOUT as L, BAND_TIMING as T, bandHeadlineRows, bandTextWidth, resolvePromoBand,
  type BandFallback, type BandItem, type BandLink, type PromoBandModel,
} from '@/blynk/promo/promoBand';
import { useStore } from '@/blynk/store/StoreContext';
import { PROMO } from '@/demo/home';
import { DEMO } from '@/demo/mode';
import { openAisle } from '@/lib/nav';
import { F } from '@/lib/theme';
import { CheckBoxIcon } from './icons';
import { PressScale } from './ui';

/** Blynk's rider illustration: the band's mascot (owner: illustrated, not a photo). */
const RIDER = require('../../assets/rider.png');

/*
 * Home's yellow promo band with scalloped edges (docs/promo-surfaces.md §1). Admin and Ops
 * set its headlines, ticked points, colours, the item in the light beam, the mascot, a link
 * and a schedule (GET /store `promo_band`); until they do - or on an older API, or in the
 * design mock - it draws exactly the band Home always had: Blynk yellow, the live copy and
 * the waving rider. Hidden while Admin / Ops have it off or outside its schedule.
 */
export function PromoBand({ live }: { live?: BandFallback }) {
  const store = useStore();
  const model = useMemo(
    () => resolvePromoBand(DEMO ? undefined : store?.promo_band, live ?? PROMO_FALLBACK),
    [store?.promo_band, live],
  );
  if (!model) return null;
  return <PromoBandView model={model} />;
}

const PROMO_FALLBACK: BandFallback = { line1: PROMO.line1, fees: PROMO.fees };

function go(link: BandLink) {
  if (link.kind === 'aisle') openAisle({ slug: link.slug, name: link.name });
  else if (link.kind === 'product') router.push({ pathname: '/p/[id]', params: { id: link.id } });
  else router.push('/search');
}

/** Draws a resolved band (also what a design review renders directly). */
export function PromoBandView({ model }: { model: PromoBandModel }) {
  const { width } = useWindowDimensions();
  const textW = bandTextWidth(width, model);
  const rows = bandHeadlineRows(model.lines, textW);
  const ink = model.colors.text;
  const body = (
    <View style={{ marginTop: 2, marginBottom: 22 }} accessible={!!model.link} accessibilityRole={model.link ? 'button' : undefined} accessibilityLabel={model.lines[0] ?? model.ticks.join(', ')}>
      <Scallop color={model.colors.start} />
      <LinearGradient colors={[model.colors.start, model.colors.end]} style={styles.body}>
        {model.item.kind !== 'NONE' && <Beam item={model.item} right={model.mascot !== 'OFF' ? L.beamRightWithMascot : L.beamRightAlone} />}
        {model.lines.length > 0 && (
          <View style={[styles.row, { marginBottom: model.ticks.length ? 9 : 0, maxWidth: textW, alignItems: 'flex-start' }]}>
            <View style={{ marginTop: 2 }}><CheckBoxIcon size={14} color={ink} /></View>
            <SlidingLines lines={model.lines} color={ink} rows={rows} />
          </View>
        )}
        {model.ticks.length > 0 && (
          <View style={[styles.row, { flexWrap: 'wrap', maxWidth: textW, rowGap: 4 }]}>
            {model.ticks.map((f) => (
              <View key={f} style={[styles.row, { marginRight: 12 }]}>
                <CheckBoxIcon size={14} color={ink} />
                <Text style={[styles.txt, { color: ink }]}>{f}</Text>
              </View>
            ))}
          </View>
        )}
        {model.mascot !== 'OFF' && <Mascot kind={model.mascot} />}
      </LinearGradient>
      <Scallop color={model.colors.end} flip />
    </View>
  );
  if (!model.link) return body;
  const link = model.link;
  return <PressScale scaleTo={0.985} onPress={() => go(link)}>{body}</PressScale>;
}

/** The headlines, one at a time: each holds, slides up and out, and the next rises in. */
function SlidingLines({ lines, color, rows }: { lines: string[]; color: string; rows: 1 | 2 }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const y = useSharedValue(0);
  const o = useSharedValue(1);
  const key = lines.join('\n');

  useEffect(() => {
    setI(0);
    y.value = 0;
    o.value = 1;
    if (lines.length < 2) return;
    const advance = () => {
      setI((n) => n + 1);
      if (reduced) return;
      y.value = 12;
      o.value = 0;
      y.value = withTiming(0, { duration: T.lineIn, easing: Easing.out(Easing.quad) });
      o.value = withTiming(1, { duration: T.lineIn, easing: Easing.out(Easing.quad) });
    };
    const t = setInterval(() => {
      if (reduced) { advance(); return; }
      y.value = withTiming(-10, { duration: T.lineOut, easing: Easing.in(Easing.quad) });
      o.value = withTiming(0, { duration: T.lineOut, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(advance);
      });
    }, T.lineHold);
    return () => clearInterval(t);
  }, [key, reduced]);

  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <View style={{ flex: 1, height: rows * L.lineHeight, overflow: 'hidden' }}>
      <Animated.View style={a}>
        <Text style={[styles.txt, { color }]} numberOfLines={rows}>{lines[i % lines.length]}</Text>
      </Animated.View>
    </View>
  );
}

/** The rider: waves (today's band) or rides in and bobs on the spot. */
function Mascot({ kind }: { kind: 'WAVE' | 'RIDE' }) {
  const reduced = useReducedMotion();
  const w = useSharedValue(0);
  const x = useSharedValue(kind === 'RIDE' && !reduced ? 120 : 0);
  useEffect(() => {
    if (reduced) return;
    if (kind === 'WAVE') {
      w.value = withRepeat(withSequence(
        withTiming(1, { duration: T.waveStep }), withTiming(-1, { duration: T.waveStep }), withTiming(1, { duration: T.waveStep }),
        withTiming(0, { duration: T.waveStep }), withTiming(0, { duration: T.waveRest }),
      ), -1);
    } else {
      x.value = withTiming(0, { duration: T.rideIn, easing: Easing.out(Easing.cubic) });
      w.value = withRepeat(withTiming(1, { duration: T.rideBob, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
  }, [kind, reduced]);
  const a = useAnimatedStyle(() => (kind === 'WAVE'
    ? { transform: [{ rotate: `${w.value * 10}deg` }] }
    : { transform: [{ translateX: x.value }, { translateY: -3 * w.value }, { rotate: `${-2 * w.value}deg` }] }));
  return <Animated.Image source={RIDER} resizeMode="contain" style={[styles.mascot, a]} accessibilityIgnoresInvertColors />;
}

/** A soft light cone with the item floating in its middle. */
function Beam({ item, right }: { item: Exclude<BandItem, { kind: 'NONE' }>; right: number }) {
  const reduced = useReducedMotion();
  const drop = useSharedValue(reduced ? 1 : 0);
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduced) { drop.value = 1; return; }
    drop.value = 0;
    drop.value = withSpring(1, { damping: 12, stiffness: 150 });
    bob.value = withRepeat(withTiming(1, { duration: T.itemBob, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [reduced, item.kind === 'IMAGE' ? item.uri : item.emoji]);
  const beamA = useAnimatedStyle(() => ({ opacity: 0.85 + bob.value * 0.15 }));
  const itemA = useAnimatedStyle(() => ({
    opacity: drop.value < 0.05 ? 0 : 1,
    transform: [{ translateY: (1 - drop.value) * -40 + (bob.value * 6 - 3) }, { scale: 0.2 + drop.value * 0.8 }],
  }));
  const w = L.beamBottom;
  return (
    <View pointerEvents="none" style={[styles.beam, { right, width: w }]}>
      <Animated.View style={[StyleSheet.absoluteFill, beamA]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${w} 100`} preserveAspectRatio="none">
          <Defs>
            <SvgGrad id="pbBeam" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFBE6" stopOpacity="0.95" />
              <Stop offset="1" stopColor="#FFFBE6" stopOpacity="0" />
            </SvgGrad>
          </Defs>
          <Polygon points={`${(w - L.beamTop) / 2},0 ${(w + L.beamTop) / 2},0 ${w},100 0,100`} fill="url(#pbBeam)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.item, { left: (w - L.item) / 2 }, itemA]}>
        {item.kind === 'IMAGE'
          ? <Image source={{ uri: item.uri }} resizeMode="contain" style={{ width: L.item, height: L.item }} />
          : <Text style={styles.emoji}>{item.emoji}</Text>}
      </Animated.View>
    </View>
  );
}

/** The scalloped edge (26 pt period), drawn in the band's top or bottom colour. */
function Scallop({ color, flip }: { color: string; flip?: boolean }) {
  const w = 390;
  let d = 'M0 10';
  for (let x = 0; x < w; x += 26) d += ` Q${x + 6.5} 4 ${x + 13} 7 T${x + 26} 8`;
  d += ` L${w} 14 L0 14 Z`;
  return (
    <Svg width="100%" height={L.scallop} viewBox={`0 0 ${w} 14`} preserveAspectRatio="none" style={flip ? { transform: [{ scaleY: -1 }] } : undefined}>
      <Path d={d} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: L.padX, paddingTop: L.padTop, paddingBottom: L.padBottom, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  txt: { fontFamily: F.semi, fontSize: L.fontSize, lineHeight: L.lineHeight },
  mascot: { position: 'absolute', right: 10, bottom: 2, width: L.mascot, height: L.mascot },
  beam: { position: 'absolute', top: 0, bottom: 0 },
  item: { position: 'absolute', top: '56%', marginTop: -L.item / 2, width: L.item, height: L.item, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 40, lineHeight: 50, textAlign: 'center', filter: 'drop-shadow(0px 6px 5px rgba(0,0,0,0.3))' } as object,
});
