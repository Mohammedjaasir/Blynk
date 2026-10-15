import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withTiming,
} from 'react-native-reanimated';
import { countUpAt, firstName, initialOf, type OpenStatus } from '@/blynk/account/tabHeroes';
import { BEAM_ITEMS } from '@/blynk/lib/aisleArt';
import { formatLkr } from '@/blynk/lib/money';
import { HELP_HERO, PROFILE_HERO } from '@/blynk/ui/strings';
import { PressScale } from '@/components/ui';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import { useActive } from '@/lib/useActive';

/*
 * The yellow heroes on top of the Profile and Help tabs (owner 2026-10-15: "make this page
 * animated, it looks so simple"). Profile: the Blynk rider bobbing with groceries floating round
 * him, and either the guest's "Log in" (a soft pulse asks for the tap) or the greeting - an
 * avatar that pops in, the points counting up, quick chips. Help: a swaying lifebuoy and the
 * store's open-now chip (its dot pulses while the store is open).
 *
 * One idle clock per hero (HERO_IDLE_MS, linear 0 -> 1) drives every loop through cheap style
 * worklets: transform / opacity only. It runs only while the tab is focused, the page visible and
 * the app in front (useActive), and never under reduced motion (everything drawn in place).
 */

const RIDER = require('../../assets/rider.png');
const RIDER_ASPECT = 240 / 234;
const TAU = Math.PI * 2;
export const HERO_IDLE_MS = 2400;

/** The hero's idle clock: loops while `run`, stopped (and parked) otherwise. */
function useIdleClock(run: boolean): SharedValue<number> {
  const clock = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(clock); return; }
    clock.value = 0;
    clock.value = withRepeat(withTiming(1, { duration: HERO_IDLE_MS, easing: Easing.linear }), -1);
    return () => cancelAnimation(clock);
  }, [run]);
  return clock;
}

/** 0 -> 1 once on mount (after `delay`), or 1 straight away under reduced motion. */
function useEntrance(reduced: boolean, delay = 0, duration = 420): SharedValue<number> {
  const [still] = useState(reduced);
  const v = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    v.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
  }, []);
  return v;
}

/** `bleed`: the page's padding, undone so the yellow runs edge to edge. */
function HeroShell({ top, bleed = 0, children }: { top: number; bleed?: number; children: ReactNode }) {
  return (
    <View style={[styles.hero, { paddingTop: top + 14, marginHorizontal: -bleed, marginTop: -bleed }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.glow, { width: 240, height: 240, right: -70, top: -80 }]} />
        <View style={[styles.glow, { width: 160, height: 160, left: -60, bottom: -50, opacity: 0.35 }]} />
      </View>
      {children}
    </View>
  );
}

/* ---------------------------------------------------------------- Profile */

export type HeroChip = { key: string; label: string; icon: string; onPress: () => void };

export function ProfileHero({ top, bleed, signedIn, name, lines, points, chips, onLogin, onPoints }: {
  top: number;
  bleed?: number;
  signedIn: boolean;
  /** The customer's full name (signed in). */
  name?: string | null;
  /** Phone / email under the greeting. */
  lines?: string[];
  /** The Blynk Points balance while the programme is on (signed in). */
  points?: { balance: number; valueLkr: number } | null;
  /** Quick links under the greeting (data-driven: a new one is one more entry). */
  chips?: HeroChip[];
  /** The guest's Log in; absent (the design preview) = no button. */
  onLogin?: () => void;
  onPoints?: () => void;
}) {
  const reduced = useReducedMotion();
  const active = useActive();
  const clock = useIdleClock(active && !reduced);
  const text = useEntrance(reduced, 60, 380);
  const textA = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: (1 - text.value) * 10 }] }));
  const first = firstName(name);

  return (
    <HeroShell top={top} bleed={bleed}>
      <View style={styles.topRow}>
        {signedIn && <Avatar name={name ?? null} reduced={reduced} />}
        <Animated.View style={[{ flex: 1 }, textA]}>
          {signedIn ? (
            <>
              <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{first ? PROFILE_HERO.hi(first) : PROFILE_HERO.hiNoName}</Text>
              {(lines ?? []).map((l) => <Text key={l} style={styles.line} numberOfLines={1}>{l}</Text>)}
            </>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">{PROFILE_HERO.title}</Text>
              <Text style={styles.sub}>{PROFILE_HERO.guestSub}</Text>
            </>
          )}
        </Animated.View>
        <RiderStage size={signedIn ? 74 : 104} clock={clock} reduced={reduced} items={signedIn ? 2 : 3} />
      </View>

      {!signedIn && onLogin && <LoginButton onPress={onLogin} clock={clock} reduced={reduced} />}

      {signedIn && !!points && (
        <PressScale onPress={onPoints} scaleTo={0.97} style={styles.points} accessibilityRole="button"
          accessibilityLabel={`${points.balance} ${PROFILE_HERO.pointsUnit(points.balance)}, ${formatLkr(points.valueLkr)}`}>
          <Text style={styles.pointsStar}>⭐</Text>
          <CountUp value={points.balance} reduced={reduced} style={styles.pointsNum} />
          <Text style={styles.pointsUnit}>{PROFILE_HERO.pointsUnit(points.balance)}</Text>
          <Text style={styles.pointsWorth}>= {formatLkr(points.valueLkr)}</Text>
        </PressScale>
      )}

      {signedIn && !!chips?.length && (
        <View style={styles.chips}>
          {chips.map((c, i) => <Chip key={c.key} chip={c} index={i} reduced={reduced} />)}
        </View>
      )}
    </HeroShell>
  );
}

/** The avatar: the name's first letter in an ink circle that pops in with a little overshoot. */
function Avatar({ name, reduced }: { name: string | null; reduced: boolean }) {
  const letter = initialOf(name);
  const [still] = useState(reduced);
  const pop = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    pop.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 190 }));
  }, []);
  const a = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 2),
    transform: [{ scale: 0.3 + 0.7 * pop.value }, { rotate: `${(1 - pop.value) * -25}deg` }],
  }));
  return (
    <Animated.View style={[styles.avatar, a]} accessible accessibilityLabel={name ? PROFILE_HERO.avatar(name) : undefined}>
      <Text style={letter ? styles.avatarLetter : styles.avatarEmoji}>{letter ?? '🙂'}</Text>
    </Animated.View>
  );
}

/** A number that counts up from 0 to `value` (ease-out, ~0.8 s) whenever the value arrives or changes. */
function CountUp({ value, reduced, style }: { value: number; reduced: boolean; style: object }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = Date.now();
    const ms = 800;
    const step = () => {
      const t = (Date.now() - t0) / ms;
      setShown(countUpAt(value, t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <Text style={style}>{reduced ? value : shown}</Text>;
}

function Chip({ chip, index, reduced }: { chip: HeroChip; index: number; reduced: boolean }) {
  const p = useEntrance(reduced, 260 + index * 60, 320);
  const a = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 8 }, { scale: 0.92 + 0.08 * p.value }] }));
  return (
    <Animated.View style={a}>
      <PressScale onPress={chip.onPress} scaleTo={0.94} style={styles.chip} accessibilityRole="button" accessibilityLabel={chip.label}>
        <Text style={styles.chipIcon}>{chip.icon}</Text>
        <Text style={styles.chipLabel}>{chip.label}</Text>
      </PressScale>
    </Animated.View>
  );
}

/** The guest's Log in: an ink pill with a soft ring that swells and fades once per idle beat. */
function LoginButton({ onPress, clock, reduced }: { onPress: () => void; clock: SharedValue<number>; reduced: boolean }) {
  const ring = useAnimatedStyle(() => {
    const t = Math.min(1, clock.value / 0.55);
    return {
      opacity: reduced || clock.value === 0 ? 0 : 0.28 * (1 - t),
      transform: [{ scaleX: 1 + 0.035 * t }, { scaleY: 1 + 0.28 * t }],
    };
  });
  // a gentle breath on the button itself, in step with the ring
  const btn = useAnimatedStyle(() => {
    const b = reduced ? 0 : Math.sin(Math.min(1, clock.value / 0.3) * Math.PI);
    return { transform: [{ scale: 1 + 0.018 * b }] };
  });
  return (
    <View style={styles.loginWrap}>
      <Animated.View pointerEvents="none" style={[styles.loginRing, ring]} />
      <Animated.View style={btn}>
        <PressScale onPress={onPress} haptic scaleTo={0.97} style={styles.login} accessibilityRole="button">
          <Text style={styles.loginTxt}>{PROFILE_HERO.login}</Text>
        </PressScale>
      </Animated.View>
    </View>
  );
}

/** The rider bobbing (two bobs per beat) with a few groceries floating round him. */
function RiderStage({ size, clock, reduced, items }: { size: number; clock: SharedValue<number>; reduced: boolean; items: number }) {
  const h = Math.round(size / RIDER_ASPECT);
  const enter = useEntrance(reduced, 120, 520);
  const riderA = useAnimatedStyle(() => {
    const bob = Math.sin(clock.value * TAU * 2);
    return {
      opacity: enter.value,
      transform: [{ translateX: (1 - enter.value) * 26 }, { translateY: -2.5 * (bob + 1) }, { rotate: `${bob * 0.8}deg` }],
    };
  });
  const spots = [
    { x: -0.18, y: 0.02, ph: 0, s: 0.2 },
    { x: 0.86, y: -0.06, ph: 0.4, s: 0.18 },
    { x: 0.02, y: 0.62, ph: 0.7, s: 0.17 },
  ].slice(0, items);
  return (
    <View style={{ width: size, height: h }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {spots.map((sp, k) => (
        <Floating key={k} emoji={BEAM_ITEMS[(k * 2) % BEAM_ITEMS.length]} size={Math.round(size * sp.s)} left={sp.x * size} top={sp.y * h}
          phase={sp.ph} clock={clock} reduced={reduced} delay={300 + k * 90} />
      ))}
      <Animated.View style={riderA}>
        <Image source={RIDER} resizeMode="contain" style={{ width: size, height: h }} accessibilityIgnoresInvertColors />
      </Animated.View>
    </View>
  );
}

function Floating({ emoji, size, left, top, phase, clock, reduced, delay }: {
  emoji: string; size: number; left: number; top: number; phase: number; clock: SharedValue<number>; reduced: boolean; delay: number;
}) {
  const pop = useEntrance(reduced, delay, 360);
  const a = useAnimatedStyle(() => {
    const f = Math.sin((clock.value + phase) * TAU);
    const p = pop.value;
    const s = p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - ((p - 0.7) / 0.3) * 0.12;
    return { opacity: p > 0 ? 1 : 0, transform: [{ translateY: -4 * f }, { rotate: `${f * 7}deg` }, { scale: s }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left, top, zIndex: 2 }, a]}>
      <Text style={[styles.emoji, { fontSize: size, lineHeight: Math.round(size * 1.25) }]}>{emoji}</Text>
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- Help */

export function HelpHero({ top, bleed, status }: { top: number; bleed?: number; status: OpenStatus | null }) {
  const reduced = useReducedMotion();
  const active = useActive();
  const clock = useIdleClock(active && !reduced);
  const text = useEntrance(reduced, 60, 380);
  const textA = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: (1 - text.value) * 10 }] }));
  const chip = useEntrance(reduced, 240, 360);
  const chipA = useAnimatedStyle(() => ({ opacity: chip.value, transform: [{ translateY: (1 - chip.value) * 8 }] }));
  return (
    <HeroShell top={top} bleed={bleed}>
      <View style={styles.topRow}>
        <Animated.View style={[{ flex: 1 }, textA]}>
          <Text style={styles.title} accessibilityRole="header">{HELP_HERO.title}</Text>
          <Text style={styles.sub}>{HELP_HERO.sub}</Text>
        </Animated.View>
        <Lifebuoy clock={clock} reduced={reduced} />
      </View>
      {status && (
        <Animated.View style={[styles.status, chipA]} accessible accessibilityRole="text" accessibilityLabel={status.label}>
          <StatusDot open={status.open} clock={clock} reduced={reduced} />
          <Text style={styles.statusTxt}>{status.label}</Text>
        </Animated.View>
      )}
    </HeroShell>
  );
}

/** A lifebuoy in a white disc that sways, a ring breathing round it, a chat bubble floating by. */
function Lifebuoy({ clock, reduced }: { clock: SharedValue<number>; reduced: boolean }) {
  const enter = useEntrance(reduced, 100, 520);
  const disc = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.6 + 0.4 * enter.value }],
  }));
  const buoy = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.sin(clock.value * TAU) * 12 + (1 - enter.value) * -90}deg` }] }));
  const ring = useAnimatedStyle(() => {
    const t = clock.value;
    return { opacity: reduced || t === 0 ? 0 : 0.45 * (1 - t), transform: [{ scale: 1 + 0.35 * t }] };
  });
  const bubble = useAnimatedStyle(() => {
    const f = Math.sin((clock.value + 0.3) * TAU);
    return { opacity: enter.value, transform: [{ translateY: -4 * f }, { rotate: `${f * 6}deg` }, { scale: 0.5 + 0.5 * enter.value }] };
  });
  return (
    <View style={styles.buoyStage} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[styles.buoyRing, ring]} />
      <Animated.View style={[styles.buoyDisc, disc]}>
        <Animated.Text style={[styles.buoy, buoy]}>🛟</Animated.Text>
      </Animated.View>
      <Animated.View style={[styles.bubble, bubble]}>
        <Text style={styles.bubbleTxt}>💬</Text>
      </Animated.View>
    </View>
  );
}

function StatusDot({ open, clock, reduced }: { open: boolean; clock: SharedValue<number>; reduced: boolean }) {
  const ring = useAnimatedStyle(() => {
    const t = Math.min(1, clock.value / 0.7);
    return { opacity: !open || reduced || clock.value === 0 ? 0 : 0.5 * (1 - t), transform: [{ scale: 1 + 1.7 * t }] };
  });
  const color = open ? C.green : C.faint;
  return (
    <View style={styles.dot}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: color }, ring]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: C.brand, paddingHorizontal: 18, paddingBottom: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    overflow: 'hidden', marginBottom: 14,
  },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: '#FFF3A8', opacity: 0.6 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: F.bold, fontSize: 25, lineHeight: 30, color: C.brandInk, letterSpacing: -0.4 },
  sub: { fontFamily: F.medium, fontSize: 14, lineHeight: 19, color: C.brandInk, opacity: 0.78, marginTop: 4 },
  line: { fontFamily: F.medium, fontSize: 13, color: C.brandInk, opacity: 0.75, marginTop: 2 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#FFF6C2',
  },
  avatarLetter: { fontFamily: F.black, fontSize: 24, color: C.brand, lineHeight: 30 },
  avatarEmoji: { fontSize: 24, lineHeight: 30 },
  loginWrap: { marginTop: 16 },
  loginRing: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 26, backgroundColor: C.ink },
  login: { height: 50, borderRadius: 25, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  loginTxt: { fontFamily: F.bold, fontSize: 16, color: C.brand, letterSpacing: 0.2 },
  points: {
    flexDirection: 'row', alignItems: 'baseline', gap: 6, alignSelf: 'flex-start', marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  pointsStar: { fontSize: 15 },
  pointsNum: { fontFamily: F.black, fontSize: 19, color: C.brandInk, fontVariant: ['tabular-nums'] },
  pointsUnit: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
  pointsWorth: { fontFamily: F.medium, fontSize: 13, color: C.brandText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999,
    paddingHorizontal: 13, height: 36,
  },
  chipIcon: { fontSize: 14 },
  chipLabel: { fontFamily: F.semi, fontSize: 13.5, color: C.ink },
  emoji: { textAlign: 'center', filter: 'drop-shadow(0px 3px 2px rgba(26,29,46,0.20))' } as object,
  buoyStage: { width: 96, height: 92, alignItems: 'center', justifyContent: 'center' },
  buoyRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: '#fff' },
  buoyDisc: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  buoy: { fontSize: 42, lineHeight: 52 },
  bubble: { position: 'absolute', left: -2, top: -2 },
  bubbleTxt: { fontSize: 22, lineHeight: 28 },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 14,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 13, height: 34,
  },
  dot: { width: 10, height: 10 },
  statusTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink },
});
