import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInDown, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { withSpring } from '@/lib/motion';
import { formatLkr } from '@/blynk/lib/money';
import { CoverageCard } from '@/blynk/area/AreaSteps';
import { coverageOf } from '@/blynk/area/coverage';
import { getOrder } from '@/blynk/orders/api';
import { placedFromMemory } from '@/blynk/orders/checkout';
import { placedLayout } from '@/blynk/orders/placedLayout';
import { slotWindowText } from '@/blynk/orders/status';
import { PAY } from '@/blynk/payments/copy';
import { PLACED } from '@/blynk/ui/strings';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import { paidByWallet } from '@/blynk/wallet/models';
import { placedPointsLine } from '@/blynk/store/pointsPromo';
import { useStore } from '@/blynk/store/StoreContext';
import type { Order } from '@/blynk/orders/types';
import { Confetti, PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
/** Blynk's rider illustration (the same artwork as Home's promo band). */
const RIDER = require('../../assets/rider.png');

/** Entrance timeline in ms from the screen opening: everything has landed by ~1.8 s. */
const T = {
  ring: 550, tickAt: 430, tick: 360, popAt: 380, rippleAt: 820, rippleGap: 320, ripple: 720, confettiAt: 720,
  rideAt: 250, ride: 850, waveAt: 1120, waveStep: 130, bob: 950,
  title: 520, sub: 620, stage: 700, facts: 760, numberAt: 920, numberStep: 26, shineAt: 1350, shine: 750,
  coverage: 860, buttons: 960, pulseAt: 2500, stageHold: 2800, basketAt: 1250,
} as const;
const ENTER = (reduced: boolean, delay: number) => (reduced
  ? FadeIn.duration(260).delay(Math.min(delay, 300))
  : FadeInDown.springify().mass(1).energyThreshold(1e-4).damping(15).stiffness(170).delay(delay));

/**
 * Order placed: the ring draws, the tick draws, two soft ripples spread, confetti bursts, and
 * the Blynk rider rides in from the left with the order, waves and bobs beside the check.
 * Live: the cart's "Place order" lands here as /placed?id=<order id> with the order the server
 * returned (fetched again after a reload): its number, the total to pay in cash (or "Paid
 * online" after PayHere, from /payment/return), "Track order" to /order/<id>, and the small
 * delivery-area card. The cart is emptied only for an order placed just now.
 * Layout: one centred column, min(width - 48, 360), shared by both cards and the buttons;
 * the screen scrolls on short phones and stays vertically centred on tall ones.
 * Motion: reanimated on the UI thread, transform/opacity only; with Reduce Motion only fades;
 * the idle loops (rider bob, basket hop, stage lines, button pulse) stop while unfocused.
 */
export default function Placed() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const L = placedLayout(width, height);
  const { clear } = cartActions;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const fresh = !DEMO && id ? placedFromMemory(id) : null;
  // an online order remembered before it was paid: ask the server again for its payment
  const stale = !!fresh && fresh.payment_method === 'ONLINE' && fresh.payment_status !== 'PAID';
  const [order, setOrder] = useState<Order | null>(fresh);
  const [burst, setBurst] = useState(0);
  const [focused, setFocused] = useState(true);
  // how late the order arrived (fetched after a reload): its cards start that much sooner
  const [late, setLate] = useState(0);
  /** A delay on the screen's timeline: what mounts late (the fetched order) starts at once. */
  const at = (ms: number) => Math.max(0, ms - late);
  const store = useStore();
  const paidOnline = order?.payment_method === 'ONLINE' && order.payment_status === 'PAID';
  const dropAt = order ? { lat: Number(order.delivery_latitude), lng: Number(order.delivery_longitude) } : null;
  const scheduled = !DEMO && !!order?.scheduled_for;
  const slot = order ? slotWindowText(order.scheduled_for, order.scheduled_until) : null;
  const pointsLine = placedPointsLine(order);

  useEffect(() => {
    const t = reduced ? undefined : setTimeout(() => setBurst(Date.now()), T.confettiAt);
    if (DEMO || fresh) clear();
    const opened = Date.now();
    if (!DEMO && id && (!fresh || stale)) {
      getOrder(id).then((o) => { if (!fresh) setLate(Date.now() - opened); setOrder(o); }).catch(() => undefined);
    }
    return () => clearTimeout(t);
  }, []);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  const live = focused && !reduced;
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {/* first child, so the cards and their text paint over the falling pieces */}
      <Confetti burstKey={burst} x={width / 2} y={height * 0.32} count={60} />
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: L.column }}>
          <Hero size={L.check} mascot={L.mascot} mascotLeft={L.mascotLeft} screenW={width} column={L.column} reduced={reduced} live={live} />
          <Animated.Text entering={ENTER(reduced, T.title)} style={styles.title}>{PLACED.title}</Animated.Text>
          <Animated.View entering={ENTER(reduced, T.sub)} style={styles.subRow}>
            <Text style={styles.sub}>{scheduled ? PLACED.scheduled : PLACED.packing} </Text>
            <Basket live={live} />
          </Animated.View>
          <Animated.View entering={ENTER(reduced, T.stage)}>
            <Stages lines={scheduled ? PLACED.stagesScheduled : PLACED.stagesNow} live={focused} reduced={reduced} />
          </Animated.View>
          {!DEMO && order && (
            <Animated.View entering={ENTER(reduced, at(T.facts))} style={styles.facts}>
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{PLACED.orderNumber}</Text>
                <OrderNumber value={order.order_number} delay={at(T.numberAt)} reduced={reduced} />
              </View>
              {!!slot && (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>{PLACED.deliveryTime}</Text>
                  <Text style={styles.factValue}>{slot}</Text>
                </View>
              )}
              {order.ordered_for_someone_else === true && !!order.delivery_recipient_name && (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>{PLACED.forWhom}</Text>
                  <Text style={styles.factValue}>{order.delivery_recipient_name}</Text>
                </View>
              )}
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{PLACED.amount}</Text>
                <Text style={styles.factValue}>{formatLkr(order.total_amount)} · {paidByWallet(order) ? WALLET_COPY.paidByWallet : paidOnline ? PAY.paidOnline : order.payment_method === 'ONLINE' ? PAY.online : PAY.cod}</Text>
              </View>
              {/* Blynk Wallet: what the wallet paid (the amount above is what is left to pay) */}
              {order.wallet_amount_used > 0 && (
                <View style={styles.factRow}>
                  <Text style={styles.factLabel}>{WALLET_COPY.placedFromWallet}</Text>
                  <Text style={styles.factValue}>{formatLkr(order.wallet_amount_used)}</Text>
                </View>
              )}
              {/* Blynk Points (owner, 2026-10-14): the server's points_earn_preview, added on delivery */}
              {!!pointsLine && <Text style={styles.points}>✦ {pointsLine}</Text>}
              {!reduced && <Shine delay={at(T.shineAt)} width={L.column} />}
            </Animated.View>
          )}
          {!DEMO && order && (
            <Animated.View entering={ENTER(reduced, at(T.coverage))} style={styles.coverage}>
              <CoverageCard coverage={coverageOf(store)} pin={dropAt && Number.isFinite(dropAt.lat) && Number.isFinite(dropAt.lng) ? dropAt : null} />
            </Animated.View>
          )}
          <Animated.View entering={ENTER(reduced, at(T.buttons))} style={styles.buttons}>
            {!DEMO && id && (
              <Pulse live={live}>
                <PressScale onPress={() => router.replace({ pathname: '/order/[id]', params: { id } })} style={styles.cta} haptic>
                  <Text style={styles.ctaTxt}>{PLACED.track}</Text>
                </PressScale>
              </Pulse>
            )}
            <PressScale onPress={() => router.dismissTo('/home')} style={!DEMO && id ? styles.ghost : styles.cta} haptic>
              <Text style={!DEMO && id ? styles.ghostTxt : styles.ctaTxt}>{PLACED.home}</Text>
            </PressScale>
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

/** The check (ring, then tick), its ripples, and the rider parked to its left. */
function Hero({ size, mascot, mascotLeft, screenW, column, reduced, live }: {
  size: number; mascot: number; mascotLeft: number; screenW: number; column: number; reduced: boolean; live: boolean;
}) {
  const ring = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);
  const pop = useSharedValue(reduced ? 1 : 0);
  const r1 = useSharedValue(0);
  const r2 = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    ring.value = withTiming(1, { duration: T.ring, easing: Easing.out(Easing.cubic) });
    tick.value = withDelay(T.tickAt, withTiming(1, { duration: T.tick, easing: Easing.out(Easing.cubic) }));
    pop.value = withDelay(T.popAt, withSpring(1, { damping: 8, stiffness: 170 }));
    r1.value = withDelay(T.rippleAt, withTiming(1, { duration: T.ripple, easing: Easing.out(Easing.quad) }));
    r2.value = withDelay(T.rippleAt + T.rippleGap, withTiming(1, { duration: T.ripple, easing: Easing.out(Easing.quad) }));
  }, []);

  const ringP = useAnimatedProps(() => ({ strokeDashoffset: 302 * (1 - ring.value) }));
  const tickP = useAnimatedProps(() => ({ strokeDashoffset: 70 * (1 - tick.value) }));
  const popA = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + pop.value * 0.3 }] }));
  const ripple = (v: SharedValue<number>) => {
    'worklet';
    return { opacity: v.value === 0 ? 0 : 0.55 * (1 - v.value), transform: [{ scale: 1 + v.value * 0.75 }] };
  };
  const r1A = useAnimatedStyle(() => ripple(r1));
  const r2A = useAnimatedStyle(() => ripple(r2));
  const disc = size * 0.8; // the ring's own diameter (r 48 of 120)
  const discBox = { width: disc, height: disc, borderRadius: disc / 2, top: (size - disc) / 2, left: (column - disc) / 2 };

  return (
    <View style={{ height: size, alignItems: 'center' }}>
      <Animated.View pointerEvents="none" style={[styles.rippleRing, discBox, r1A]} />
      <Animated.View pointerEvents="none" style={[styles.rippleRing, discBox, r2A]} />
      <Animated.View style={popA}>
        {/* the ring starts at 12 o'clock: its own Svg turned -90° (an SVG rotation/origin is not a valid DOM prop on the web) */}
        <Svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={60} cy={60} r={48} fill="rgba(26,29,46,0.1)" />
          <AnimatedCircle cx={60} cy={60} r={48} stroke={C.brandInk} strokeWidth={6} fill="none" strokeDasharray="302" animatedProps={ringP} strokeLinecap="round" />
        </Svg>
        <Svg width={size} height={size} viewBox="0 0 120 120" style={StyleSheet.absoluteFill}>
          <AnimatedPath d="M38 62 L54 77 L84 45" stroke={C.brandInk} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70" animatedProps={tickP} />
        </Svg>
      </Animated.View>
      {mascot > 0 && (
        <Rider size={mascot} left={mascotLeft} top={size - mascot} from={-(mascotLeft + mascot + (screenW - column) / 2 + 8)} reduced={reduced} live={live} />
      )}
    </View>
  );
}

/** Rides in from off-screen left with speed lines, waves, then bobs while the screen is in view. */
function Rider({ size, left, top, from, reduced, live }: { size: number; left: number; top: number; from: number; reduced: boolean; live: boolean }) {
  const ride = useSharedValue(reduced ? 1 : 0);
  const fade = useSharedValue(reduced ? 0 : 1);
  const wave = useSharedValue(0);
  const bob = useSharedValue(0);
  const [parked, setParked] = useState(reduced);

  useEffect(() => {
    if (reduced) { fade.value = withTiming(1, { duration: 300 }); return; }
    const s = T.waveStep;
    ride.value = withDelay(T.rideAt, withTiming(1, { duration: T.ride, easing: Easing.out(Easing.cubic) }));
    wave.value = withDelay(T.waveAt, withSequence(
      withTiming(1, { duration: s }), withTiming(-1, { duration: s }), withTiming(1, { duration: s }),
      withTiming(0, { duration: s }, (done) => { if (done) scheduleOnRN(setParked, true); }),
    ));
  }, []);

  useEffect(() => {
    if (!parked || !live) { cancelAnimation(bob); bob.value = withTiming(0, { duration: 200 }); return; }
    bob.value = withRepeat(withTiming(1, { duration: T.bob, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(bob);
  }, [parked, live]);

  const a = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateX: from * (1 - ride.value) },
      { translateY: -3 * bob.value },
      { rotate: `${wave.value * 7 - 1.5 * bob.value}deg` },
    ],
  }));
  // speed lines: full while riding, gone as it stops
  const lines = useAnimatedStyle(() => ({ opacity: ride.value === 0 ? 0 : Math.max(0, 1 - ride.value * 1.15), transform: [{ translateX: -8 * ride.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, width: size, height: size }, a]}>
      <Animated.View style={[styles.speed, { top: size * 0.3, left: -size * 0.3 }, lines]}>
        <View style={[styles.speedLine, { width: size * 0.32 }]} />
        <View style={[styles.speedLine, { width: size * 0.22, marginLeft: size * 0.1 }]} />
        <View style={[styles.speedLine, { width: size * 0.28, marginLeft: size * 0.04 }]} />
      </Animated.View>
      <Animated.Image source={RIDER} resizeMode="contain" style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

/** The basket after the headline: a small hop every couple of seconds. */
function Basket({ live }: { live: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (!live) { cancelAnimation(y); y.value = withTiming(0, { duration: 150 }); return; }
    y.value = withDelay(T.basketAt, withRepeat(withSequence(
      withTiming(-6, { duration: 200, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 280, easing: Easing.bounce }),
      withTiming(0, { duration: 1500 }),
    ), -1));
    return () => cancelAnimation(y);
  }, [live]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${y.value * 1.5}deg` }] }));
  return <Animated.Text style={[styles.sub, a]} accessibilityElementsHidden importantForAccessibility="no">{PLACED.basket}</Animated.Text>;
}

/** The stage lines, one at a time: each holds, slides up and out, and the next rises in (fades only with Reduce Motion). */
function Stages({ lines, live, reduced }: { lines: readonly string[]; live: boolean; reduced: boolean }) {
  const [i, setI] = useState(0);
  const y = useSharedValue(0);
  const o = useSharedValue(1);
  useEffect(() => {
    if (!live || lines.length < 2) return;
    const show = () => {
      setI((n) => n + 1);
      y.value = reduced ? 0 : 8;
      o.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) });
      y.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) });
    };
    const t = setInterval(() => {
      if (!reduced) y.value = withTiming(-8, { duration: 220, easing: Easing.in(Easing.quad) });
      o.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => { if (done) scheduleOnRN(show); });
    }, T.stageHold);
    return () => clearInterval(t);
  }, [live, reduced, lines]);
  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <View style={styles.stageBox} accessibilityLiveRegion="polite">
      <Animated.Text style={[styles.stage, a]} numberOfLines={1}>{lines[i % lines.length]}</Animated.Text>
    </View>
  );
}

/** The order number ticks in a character at a time, then becomes plain selectable text. */
function OrderNumber({ value, delay, reduced }: { value: string; delay: number; reduced: boolean }) {
  const chars = [...value];
  const [done, setDone] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setDone(true), delay + chars.length * T.numberStep + 450);
    return () => clearTimeout(t);
  }, []);
  if (done) return <Text style={styles.factValue} selectable>{value}</Text>;
  return (
    <View style={styles.charRow} accessible accessibilityLabel={value}>
      {chars.map((c, k) => <Char key={k} c={c} delay={delay + k * T.numberStep} />)}
    </View>
  );
}

function Char({ c, delay }: { c: string; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 260 })); }, []);
  const a = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.6), transform: [{ translateY: (1 - p.value) * 9 }] }));
  return <Animated.Text style={[styles.factValue, a]}>{c}</Animated.Text>;
}

/** One soft light sweep across the facts card. */
function Shine({ delay, width }: { delay: number; width: number }) {
  const x = useSharedValue(0);
  useEffect(() => { x.value = withDelay(delay, withTiming(1, { duration: T.shine, easing: Easing.inOut(Easing.quad) })); }, []);
  const a = useAnimatedStyle(() => ({
    opacity: x.value === 0 || x.value === 1 ? 0 : 1,
    transform: [{ translateX: -90 + x.value * (width + 140) }, { rotate: '18deg' }],
  }));
  return (
    // its own clip, so the tilted band never adds scrollable overflow to the card
    <View pointerEvents="none" style={styles.shineClip}>
      <Animated.View style={[styles.shine, a]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

/** A soft "look here" breath on the main button, from ~2.5 s, while the screen is in view. */
function Pulse({ live, children }: { live: boolean; children: ReactNode }) {
  const s = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (!live) { cancelAnimation(s); s.value = withTiming(0, { duration: 150 }); return; }
    const wait = first.current ? T.pulseAt : 1200;
    first.current = false;
    const up = () => withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
    const down = () => withTiming(0, { duration: 380, easing: Easing.inOut(Easing.quad) });
    s.value = withDelay(wait, withRepeat(withSequence(up(), down(), up(), down(), withTiming(0, { duration: 2600 })), -1));
    return () => cancelAnimation(s);
  }, [live]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1 + s.value * 0.035 }] }));
  const halo = useAnimatedStyle(() => ({ opacity: s.value * 0.4, transform: [{ scaleX: 1 + s.value * 0.05 }, { scaleY: 1 + s.value * 0.22 }] }));
  return (
    <View style={{ alignSelf: 'stretch' }}>
      <Animated.View pointerEvents="none" style={[styles.halo, halo]} />
      <Animated.View style={a}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.brand },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  rippleRing: { position: 'absolute', borderWidth: 3, borderColor: C.brandInk, backgroundColor: 'rgba(255,255,255,0.35)' },
  speed: { position: 'absolute', gap: 6 },
  speedLine: { height: 3, borderRadius: 2, backgroundColor: 'rgba(26,29,46,0.45)' },
  title: { fontFamily: F.display, color: C.brandInk, fontSize: 30, marginTop: 18, textAlign: 'center' },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  sub: { fontFamily: F.medium, color: C.brandInk, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  stageBox: { height: 20, overflow: 'hidden', marginTop: 2, alignItems: 'center' },
  stage: { fontFamily: F.regular, color: 'rgba(26,29,46,0.72)', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  facts: {
    marginTop: 18, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden',
  },
  factRow: { paddingVertical: 5 },
  factLabel: { fontFamily: F.medium, color: 'rgba(26,29,46,0.65)', fontSize: 12 },
  factValue: { fontFamily: F.bold, color: C.brandInk, fontSize: 16, marginTop: 1, flexShrink: 1 },
  points: { fontFamily: F.medium, color: 'rgba(26,29,46,0.72)', fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  charRow: { flexDirection: 'row', flexWrap: 'wrap' },
  shineClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', borderRadius: 16 },
  shine: { position: 'absolute', top: -40, bottom: -40, left: 0, width: 70 },
  coverage: { marginTop: 12 },
  buttons: { marginTop: 22, alignItems: 'center' },
  cta: { backgroundColor: C.brandInk, borderRadius: 14, paddingHorizontal: 30, paddingVertical: 15, alignItems: 'center', alignSelf: 'stretch' },
  ctaTxt: { fontFamily: F.bold, color: C.brand, fontSize: 15 },
  halo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 16, backgroundColor: '#fff' },
  ghost: { marginTop: 8, paddingHorizontal: 30, paddingVertical: 12 },
  ghostTxt: { fontFamily: F.bold, color: C.brandInk, fontSize: 14.5, textDecorationLine: 'underline' },
});
