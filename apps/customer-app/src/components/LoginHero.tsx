import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { HERO, HERO_ITEMS, type HeroLayout, nextHeadline } from '@/blynk/ui/loginHero';
import { LOGIN } from '@/blynk/ui/strings';
import { withSpring } from '@/lib/motion';
import { splashHandover } from '@/lib/splash';
import { useActive } from '@/lib/useActive';
import { C, F } from '@/lib/theme';

/** Blynk's rider illustration (the promo band's mascot): illustrated, never a photo. */
const RIDER = require('../../assets/rider.png');
const TAU = Math.PI * 2;

/*
 * The phone login's yellow hero (owner's pick, 2026-10-14: "Rider mascot"). Once the launch
 * intro's white cover has lifted, the yellow fades in, the rider rides in from the left (speed
 * lines), brakes with a little puff and waves; the home banner's grocery items pop in round him,
 * then everything idles: the rider bobs, the items float. The headline above changes every 3 s.
 *
 * Transform / opacity only, on the UI thread. Reduced motion: everything drawn in place, the
 * headline swaps without sliding. The idle loop stops while the screen is not focused, the tab
 * is hidden or the app is in the background. With the keyboard up (or a very short window) the
 * hero is one headline row so the form keeps its room (loginHeroLayout).
 */
export function LoginHero({ layout, topInset, leading, trailing }: {
  layout: HeroLayout; topInset: number; leading?: ReactNode; trailing?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const active = useActive();
  // wait for the intro's white cover to lift: no yellow may show through the launch
  const handover = useSyncExternalStore(splashHandover.subscribe, splashHandover.get, splashHandover.get);
  const ready = handover === 'idle';
  const [bgStartedHidden] = useState(() => !ready);
  const bg = useSharedValue(bgStartedHidden ? 0 : 1);
  useEffect(() => {
    if (!ready) return;
    bg.value = reduced ? 1 : withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) });
  }, [ready, reduced]);
  const bgA = useAnimatedStyle(() => ({ opacity: bg.value }));
  const compact = layout.mode === 'compact';
  // the entrance plays once per visit: the keyboard folding the hero away and back does not replay it
  const [played, setPlayed] = useState(false);

  return (
    <View style={{ height: layout.heroH, overflow: 'hidden' }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg, bgA]}>
        <View style={[styles.glow, { width: 260, height: 260, right: -80, top: -60 }]} />
        <View style={[styles.glow, { width: 180, height: 180, left: -70, bottom: 30, opacity: 0.35 }]} />
      </Animated.View>
      <View style={[styles.row, { marginTop: topInset }]}>
        <View style={styles.side}>{leading}</View>
        {compact && (
          <View style={{ flex: 1, paddingHorizontal: 4 }}>
            <Headline size={layout.headlineSize} lineH={layout.lineH} rows={1} active={active} reduced={reduced} />
          </View>
        )}
        <View style={[styles.side, { alignItems: 'flex-end' }]}>{trailing}</View>
      </View>
      {layout.mode === 'full' && (
        <>
          <View style={{ paddingHorizontal: 20 }}>
            <Headline size={layout.headlineSize} lineH={layout.lineH} rows={2} active={active} reduced={reduced} />
          </View>
          <Scene layout={layout} go={ready && active} reduced={reduced} played={played} onPlayed={() => setPlayed(true)} bg={bg} />
        </>
      )}
    </View>
  );
}

/** One headline at a time: it holds, slides up and out, and the next rises in. */
function Headline({ size, lineH, rows, active, reduced }: { size: number; lineH: number; rows: 1 | 2; active: boolean; reduced: boolean }) {
  const lines = LOGIN.headlines;
  const [i, setI] = useState(0);
  const y = useSharedValue(0);
  const o = useSharedValue(1);

  useEffect(() => {
    if (!active || lines.length < 2) return;
    const advance = () => {
      setI((n) => nextHeadline(n, lines.length));
      if (reduced) return;
      y.value = lineH * 0.6;
      o.value = 0;
      y.value = withTiming(0, { duration: HERO.headlineInMs, easing: Easing.out(Easing.cubic) });
      o.value = withTiming(1, { duration: HERO.headlineInMs, easing: Easing.out(Easing.quad) });
    };
    const t = setInterval(() => {
      if (reduced) { advance(); return; }
      y.value = withTiming(-lineH * 0.5, { duration: HERO.headlineOutMs, easing: Easing.in(Easing.quad) });
      o.value = withTiming(0, { duration: HERO.headlineOutMs, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(advance);
      });
    }, HERO.headlineHoldMs);
    return () => {
      clearInterval(t);
      cancelAnimation(y);
      cancelAnimation(o);
      y.value = 0;
      o.value = 1;
    };
  }, [active, reduced, lineH]);

  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: rows * lineH, overflow: 'hidden', justifyContent: rows === 1 ? 'center' : 'flex-end' }}>
      <Animated.View style={a}>
        <Text
          style={[styles.headline, { fontSize: size, lineHeight: lineH }]}
          numberOfLines={rows}
          accessibilityRole="header"
        >
          {lines[i % lines.length]}
        </Text>
      </Animated.View>
    </View>
  );
}

/** The rider, the items round him, the ground. Plays its entrance once per mount. */
function Scene({ layout, go, reduced, played, onPlayed, bg }: {
  layout: Extract<HeroLayout, { mode: 'full' }>; go: boolean; reduced: boolean; played: boolean; onPlayed: () => void;
  /** the yellow's fade-in: the road comes with it, so nothing tinted shows under the intro's cover */
  bg: SharedValue<number>;
}) {
  const { width } = useWindowDimensions();
  const { sceneH, rider, item } = layout;
  const riderLeft = Math.round((width - rider) / 2 + width * 0.03);
  const riderBottom = 4;

  // entrance (0..1 each) and the idle clock
  // drawn in place: reduced motion, or the entrance already played (keyboard folded the hero)
  const [still] = useState(() => reduced || played);
  const ride = useSharedValue(still ? 1 : 0);
  const lean = useSharedValue(0);
  const lines = useSharedValue(0);
  const puff = useSharedValue(0);
  const wave = useSharedValue(0);
  const hand = useSharedValue(0);
  const pop = useSharedValue(still ? 1 : 0);
  const settle = useSharedValue(still ? 1 : 0);
  const clock = useSharedValue(0);

  // the rider picture must be there before he rides in (a cold web load fetches it late);
  // if it never says so, go anyway after a moment
  const [imgReady, setImgReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setImgReady(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // the entrance: once, as soon as the intro has gone, the screen is showing and the rider has loaded
  useEffect(() => {
    if (!go || !imgReady || still || played) return;
    onPlayed();
    if (reduced) return;
    ride.value = withDelay(120, withTiming(1, { duration: HERO.rideMs, easing: Easing.out(Easing.quad) }));
    lean.value = withSequence(
      withTiming(-1, { duration: 200 }),
      withDelay(650, withTiming(1.2, { duration: 140, easing: Easing.out(Easing.quad) })),
      withSpring(0, { damping: 9, stiffness: 160 }),
    );
    lines.value = withSequence(withTiming(1, { duration: 120 }), withDelay(560, withTiming(0, { duration: 260 })));
    puff.value = withDelay(900, withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }));
    hand.value = withDelay(HERO.waveAt, withSequence(
      withTiming(1, { duration: 140 }), withDelay(1150, withTiming(0, { duration: 260 })),
    ));
    wave.value = withDelay(HERO.waveAt, withSequence(
      withTiming(1, { duration: 150 }), withTiming(-1, { duration: 170 }), withTiming(1, { duration: 170 }),
      withTiming(-1, { duration: 170 }), withTiming(0, { duration: 150 }),
    ));
    pop.value = withDelay(HERO.itemsAt, withTiming(1, { duration: 420 + HERO.itemStagger * HERO_ITEMS.length, easing: Easing.linear }));
    settle.value = withDelay(1050, withTiming(1, { duration: 450 }));
  }, [go, imgReady, reduced]);

  // the idle loop: runs only while showing (paused otherwise), never with reduced motion
  useEffect(() => {
    if (!go || reduced) { cancelAnimation(clock); return; }
    clock.value = 0;
    clock.value = withRepeat(withTiming(1, { duration: HERO.idleMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(clock);
  }, [go, reduced]);

  const startX = -(riderLeft + rider * 1.1);
  const riderA = useAnimatedStyle(() => {
    const bob = Math.sin(clock.value * TAU * 2) * settle.value;
    return {
      transform: [
        { translateX: (1 - ride.value) * startX },
        { translateY: -2.5 * (bob + 1) * settle.value },
        { rotate: `${-2.2 * lean.value + bob * 0.6}deg` },
      ],
    };
  });
  const shadowA = useAnimatedStyle(() => {
    const bob = Math.sin(clock.value * TAU * 2) * settle.value;
    return {
      opacity: ride.value * 0.9,
      transform: [{ translateX: (1 - ride.value) * startX }, { scaleX: 1 - 0.05 * (bob + 1) * settle.value }],
    };
  });
  const roadA = useAnimatedStyle(() => ({ opacity: 0.55 * bg.value }));
  const linesA = useAnimatedStyle(() => ({ opacity: lines.value }));
  const puffA = useAnimatedStyle(() => ({
    opacity: puff.value > 0 && puff.value < 1 ? 0.75 * (1 - puff.value) : 0,
    transform: [{ translateX: -16 * puff.value }, { scale: 0.4 + puff.value }],
  }));
  const handA = useAnimatedStyle(() => ({
    opacity: hand.value,
    transform: [{ scale: 0.5 + 0.5 * hand.value }, { rotate: `${wave.value * 22}deg` }],
  }));

  const handSize = Math.round(item * 0.95);
  return (
    <View style={{ height: sceneH, marginTop: 4 }} pointerEvents="none" accessible accessibilityLabel={LOGIN.heroLabel} accessibilityRole="image">
      {/* road and the rider's shadow */}
      <Animated.View style={[styles.road, { bottom: riderBottom + 6 }, roadA]} />
      <Animated.View style={[styles.shadow, { left: riderLeft + rider * 0.18, width: rider * 0.66, bottom: riderBottom + 1 }, shadowA]} />
      {HERO_ITEMS.map((it, k) => (
        <Item key={it.emoji} k={k} emoji={it.emoji} size={item} phase={it.phase}
          left={it.x * width - item / 2} top={it.y * (sceneH - item) } pop={pop} clock={clock} settle={settle} />
      ))}
      <Animated.View style={[{ position: 'absolute', left: riderLeft, bottom: riderBottom, width: rider, height: rider }, riderA]}>
        {/* speed lines trail the scooter while it rides in */}
        <Animated.View style={[styles.lines, { left: -rider * 0.28, top: rider * 0.38 }, linesA]}>
          <View style={[styles.line, { width: rider * 0.26 }]} />
          <View style={[styles.line, { width: rider * 0.18, marginLeft: rider * 0.06 }]} />
          <View style={[styles.line, { width: rider * 0.22, marginLeft: rider * 0.02 }]} />
        </Animated.View>
        <Animated.View style={[styles.puff, { left: rider * 0.02, top: rider * 0.72 }, puffA]}>
          <View style={[styles.puffDot, { width: 14, height: 14 }]} />
          <View style={[styles.puffDot, { width: 10, height: 10, marginLeft: -4, marginTop: 6 }]} />
          <View style={[styles.puffDot, { width: 8, height: 8, marginLeft: -2, marginTop: -2 }]} />
        </Animated.View>
        <Animated.Image source={RIDER} resizeMode="contain" style={{ width: rider, height: rider }} onLoad={() => setImgReady(true)} accessibilityIgnoresInvertColors />
        <Animated.View style={[{ position: 'absolute', left: rider * 0.74, top: -rider * 0.16, width: handSize * 1.3, height: handSize * 1.3, alignItems: 'center', justifyContent: 'center' }, handA]}>
          <Text style={[styles.emoji, { fontSize: handSize, lineHeight: handSize * 1.25 }]}>👋</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** One grocery item: pops in on its turn, then floats softly on its own phase. */
function Item({ k, emoji, size, phase, left, top, pop, clock, settle }: {
  k: number; emoji: string; size: number; phase: number; left: number; top: number;
  pop: SharedValue<number>; clock: SharedValue<number>; settle: SharedValue<number>;
}) {
  const span = 420 + HERO.itemStagger * HERO_ITEMS.length;
  const from = (HERO.itemStagger * k) / span;
  const len = 420 / span;
  const a = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (pop.value - from) / len));
    // a soft overshoot: 0 -> 1.12 -> 1
    const s = p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - ((p - 0.7) / 0.3) * 0.12;
    const f = Math.sin((clock.value + phase) * TAU) * settle.value;
    return {
      opacity: p > 0 ? 1 : 0,
      transform: [{ translateY: -5 * f + (1 - p) * 10 }, { rotate: `${f * 6}deg` }, { scale: s }],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left, top, width: size * 1.3, height: size * 1.3, alignItems: 'center', justifyContent: 'center' }, a]}>
      <Text style={[styles.emoji, { fontSize: size, lineHeight: size * 1.25 }]}>{emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: C.brand, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: '#FFF3A8', opacity: 0.55 },
  row: { height: HERO.rowH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, zIndex: 2 },
  side: { minWidth: 48, justifyContent: 'center' },
  headline: { color: C.brandInk, fontFamily: F.bold, letterSpacing: -0.3 },
  road: { position: 'absolute', left: 24, right: 24, height: 3, borderRadius: 2, backgroundColor: C.brandDeep },
  shadow: { position: 'absolute', height: 10, borderRadius: 999, backgroundColor: 'rgba(26,29,46,0.10)' },
  lines: { position: 'absolute', gap: 7 },
  line: { height: 3.5, borderRadius: 2, backgroundColor: C.brandInk, opacity: 0.55 },
  puff: { position: 'absolute', flexDirection: 'row' },
  puffDot: { borderRadius: 999, backgroundColor: '#FFFFFF' },
  emoji: { textAlign: 'center', filter: 'drop-shadow(0px 4px 3px rgba(26,29,46,0.22))' } as object,
});
