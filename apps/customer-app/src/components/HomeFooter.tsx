import { memo, useEffect } from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';
import { BEAM_ITEMS } from '@/blynk/lib/aisleArt';
import { HOME_FOOTER } from '@/blynk/ui/strings';
import { footerBeat, runFooterBeat } from '@/lib/clock';
import { C, F } from '@/lib/theme';

/*
 * The end of Home's list (owner 2026-10-15, Toing's footer: grey "Great taste delivered / at lowest
 * rate" over the mascot bouncing on a trampoline with food floating round him). Blynk's version says
 * only what is true ("Fresh groceries delivered / to your door in Dharga Town", src/blynk/ui/strings.ts)
 * and draws the trampoline in Blynk colours: a yellow mat in an ink frame on ink legs.
 *
 * Motion (one shared clock, footerBeat, 4 s; transform / opacity only): the rider bounces once a
 * second - squashes on landing while the mat dents, stretches on take-off, floats at the top; a soft
 * shadow on the mat shrinks and fades as he rises; the app's grocery set (BEAM_ITEMS) floats and bobs
 * round him, each at its own phase. Home runs the clock only while the footer is on screen and Home
 * is focused (`active`); everything stands still under reduced motion.
 *
 * FOOTER_MASCOT: the only mascot asset today is the rider on his scooter (assets/rider.png). When the
 * owner supplies a standing mascot, swap the image and its aspect ratio here - nothing else changes.
 */
export const FOOTER_MASCOT: { source: ImageSourcePropType; aspect: number } = {
  source: require('../../assets/rider.png'),
  aspect: 240 / 234, // width / height of the picture
};

const STAGE_W = 260;
const STAGE_H = 206;
const MASCOT_W = 96;
const MASCOT_H = Math.round(MASCOT_W / FOOTER_MASCOT.aspect);
const TRAMP_W = 156;
const TRAMP_H = 70;
const MAT_Y = 16; // the mat's centre line inside the trampoline drawing
const REST = STAGE_H - TRAMP_H + MAT_Y + 3; // where the mascot's feet / wheels touch the mat
const JUMP = 40; // how high he goes
const CONTACT = 0.2; // share of each bounce spent on the mat
/** The floating groceries round him: x, y off the mascot's resting centre; bob size; phase. */
const ITEMS: { x: number; y: number; bob: number; ph: number; size: number }[] = [
  { x: -96, y: -40, bob: 6, ph: 0.0, size: 24 },
  { x: 96, y: -46, bob: 7, ph: 0.35, size: 24 },
  { x: -66, y: -88, bob: 5, ph: 0.6, size: 21 },
  { x: 68, y: -94, bob: 6, ph: 0.15, size: 21 },
  { x: -114, y: 8, bob: 4, ph: 0.8, size: 19 },
  { x: 114, y: 4, bob: 5, ph: 0.5, size: 19 },
];
const TWO_PI = Math.PI * 2;

export const HomeFooter = memo(function HomeFooter({ active }: {
  /** The footer is on screen and Home is the focused screen. */
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const run = active && !reduced;
  useEffect(() => {
    runFooterBeat(run);
    return () => runFooterBeat(false);
  }, [run]);
  return (
    <View style={styles.root} accessible accessibilityRole="text" accessibilityLabel={HOME_FOOTER.label}>
      <Text style={styles.small}>{HOME_FOOTER.small}</Text>
      <Text style={styles.large}>{HOME_FOOTER.large}</Text>
      <View style={styles.stage} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Trampoline beat={footerBeat} still={reduced} />
        {ITEMS.map((it, k) => (
          <Item key={k} emoji={BEAM_ITEMS[k % BEAM_ITEMS.length]} item={it} beat={footerBeat} still={reduced} />
        ))}
        <Mascot beat={footerBeat} still={reduced} />
      </View>
    </View>
  );
});

/** 0 → 1 → 0 across a bounce while airborne; `d` is how deep the mat is pressed while on it. */
function bounce(beat: number) {
  'worklet';
  const u = (beat * 4) % 1;
  if (u < CONTACT) return { h: 0, d: Math.sin((Math.PI * u) / CONTACT), a: -1 };
  const a = (u - CONTACT) / (1 - CONTACT);
  return { h: 4 * a * (1 - a), d: 0, a };
}

function Mascot({ beat, still }: { beat: SharedValue<number>; still: boolean }) {
  const s = useAnimatedStyle(() => {
    if (still) return { transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] };
    const { h, d, a } = bounce(beat.value);
    // squash on the mat, stretch just after take-off and just before landing
    let sy = 1 - 0.13 * d;
    let sx = 1 + 0.09 * d;
    if (a >= 0 && a < 0.18) { const k = 1 - a / 0.18; sy = 1 + 0.08 * k; sx = 1 - 0.05 * k; }
    else if (a > 0.86) { const k = (a - 0.86) / 0.14; sy = 1 + 0.05 * k; sx = 1 - 0.03 * k; }
    // scale about the feet: keep the bottom edge where it is, then lift and sink with the mat
    const keepFeet = (MASCOT_H * (1 - sy)) / 2;
    return { transform: [{ translateY: -h * JUMP + d * 6 + keepFeet }, { scaleX: sx }, { scaleY: sy }] };
  });
  return (
    <Animated.View style={[styles.mascot, s]}>
      <Image source={FOOTER_MASCOT.source} resizeMode="contain" style={{ width: MASCOT_W, height: MASCOT_H }} accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

function Trampoline({ beat, still }: { beat: SharedValue<number>; still: boolean }) {
  // the mat dents under him and his shadow on it shrinks and fades as he rises
  const dent = useAnimatedStyle(() => {
    const d = still ? 0 : bounce(beat.value).d;
    return { opacity: 0.75 * d, transform: [{ scaleX: 0.55 + 0.45 * d }, { scaleY: 0.5 + 0.5 * d }] };
  });
  const shadow = useAnimatedStyle(() => {
    const h = still ? 0 : bounce(beat.value).h;
    return { opacity: 0.16 - 0.1 * h, transform: [{ scale: 1 - 0.5 * h }] };
  });
  const legs = [14, 44, 112, 142];
  return (
    <View style={styles.tramp}>
      {/* soft ground shadow under the legs */}
      <View style={styles.ground} />
      <Svg width={TRAMP_W} height={TRAMP_H} viewBox={`0 0 ${TRAMP_W} ${TRAMP_H}`} style={StyleSheet.absoluteFill}>
        {legs.map((x) => {
          const near = x === 44 || x === 112; // the front legs are a touch longer
          const y2 = near ? TRAMP_H - 4 : TRAMP_H - 10;
          return (
            <Path key={x} d={`M${x} ${MAT_Y + 6} L${x + (x < 78 ? -2 : 2)} ${y2} l${x < 78 ? -4 : 4} 0`} stroke={C.ink} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          );
        })}
        {/* mat, then the padded ink frame round it */}
        <Ellipse cx={TRAMP_W / 2} cy={MAT_Y} rx={TRAMP_W / 2 - 6} ry={13} fill={C.brand} />
        <Ellipse cx={TRAMP_W / 2} cy={MAT_Y + 2} rx={TRAMP_W / 2 - 18} ry={7} fill={C.brandDeep} opacity={0.35} />
        <Ellipse cx={TRAMP_W / 2} cy={MAT_Y} rx={TRAMP_W / 2 - 5} ry={13.5} stroke={C.ink} strokeWidth={6} fill="none" />
        <Line x1={TRAMP_W / 2 - 44} y1={MAT_Y - 8.5} x2={TRAMP_W / 2 - 18} y2={MAT_Y - 11.5} stroke="#fff" strokeOpacity={0.35} strokeWidth={2} strokeLinecap="round" />
      </Svg>
      <Animated.View style={[styles.dent, dent]} />
      <Animated.View style={[styles.shadow, shadow]} />
    </View>
  );
}

function Item({ emoji, item, beat, still }: {
  emoji: string; item: (typeof ITEMS)[number]; beat: SharedValue<number>; still: boolean;
}) {
  const s = useAnimatedStyle(() => {
    if (still) return { transform: [{ translateY: 0 }, { rotate: '0deg' }, { scale: 1 }] };
    const b = Math.sin(TWO_PI * (beat.value * 2 + item.ph));
    const lift = bounce(beat.value).h * 8; // they rise a little with him
    return {
      transform: [
        { translateY: -b * item.bob - lift },
        { rotate: `${Math.sin(TWO_PI * (beat.value + item.ph)) * 10}deg` },
        { scale: 1 + 0.06 * Math.sin(TWO_PI * (beat.value * 2 + item.ph + 0.25)) },
      ],
    };
  });
  const left = STAGE_W / 2 + item.x - item.size / 2;
  const top = REST - MASCOT_H / 2 + item.y - item.size / 2;
  return (
    <Animated.View style={[{ position: 'absolute', left, top }, s]}>
      <Text style={{ fontSize: item.size, lineHeight: Math.round(item.size * 1.25) }}>{emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 40, paddingBottom: 8, paddingHorizontal: 16 },
  small: { fontFamily: F.semi, fontSize: 14, color: '#B4B5BE', textAlign: 'center' },
  large: { fontFamily: F.black, fontSize: 25, lineHeight: 30, color: '#C6C7CF', textAlign: 'center', letterSpacing: -0.4, marginTop: 1 },
  stage: { width: STAGE_W, height: STAGE_H, marginTop: 14 },
  mascot: { position: 'absolute', left: (STAGE_W - MASCOT_W) / 2, top: REST - MASCOT_H, width: MASCOT_W, height: MASCOT_H },
  tramp: { position: 'absolute', left: (STAGE_W - TRAMP_W) / 2, bottom: 0, width: TRAMP_W, height: TRAMP_H },
  ground: {
    position: 'absolute', left: 6, right: 6, bottom: -2, height: 12, borderRadius: 999,
    backgroundColor: 'rgba(26,29,46,0.06)',
  },
  dent: {
    position: 'absolute', left: TRAMP_W / 2 - 40, width: 80, top: MAT_Y - 6, height: 14, borderRadius: 999,
    backgroundColor: C.brandDeep,
  },
  shadow: {
    position: 'absolute', left: TRAMP_W / 2 - 34, width: 68, top: MAT_Y - 4, height: 9, borderRadius: 999,
    backgroundColor: C.ink,
  },
});
