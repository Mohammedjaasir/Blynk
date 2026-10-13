import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  type SharedValue,
  withDelay,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import Svg, { Circle, Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { cartActions, useCartSelect } from '@/lib/cart';
import { flip, startClocks, sway } from '@/lib/clock';
import type { Product } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { isOfferActive, savingsPerUnit } from '@/blynk/lib/pricing';
import { C, F } from '@/lib/theme';
import { ChevronIcon, CloseIcon, HeartsIcon } from './icons';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

/* ---------- Press feedback: every tappable surface squishes like the original ---------- */
export function PressScale({
  children, onPress, style, scaleTo = 0.95, disabled, haptic = false,
}: {
  children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>;
  scaleTo?: number; disabled?: boolean; haptic?: boolean;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={() => s.set(withSpring(scaleTo, { damping: 18, stiffness: 420 }))}
      onPressOut={() => s.set(withSpring(1, { damping: 12, stiffness: 300 }))}
      onPress={() => {
        if (haptic) tap();
        onPress?.();
      }}
      style={[style, a]}
    >
      {children}
    </AnimatedPressable>
  );
}

/* ---------- Skeleton with a sweeping shimmer ---------- */
export function Skeleton({ w, h, r = 8, style }: { w?: number | `${number}%`; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const x = useSharedValue(0);
  const width = useSharedValue(300);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, []);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(x.value, [0, 1], [-width.value * 0.7, width.value * 1.1]) }],
  }));
  return (
    <View
      onLayout={(e) => (width.value = e.nativeEvent.layout.width)}
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.skeleton, overflow: 'hidden' }, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { width: '60%' }, a]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/* ---------- Odometer-style text: new value rolls in, old rolls out ---------- */
export function RollingText({ text, style, numeric }: { text: string; style?: StyleProp<TextStyle>; numeric?: number }) {
  // remember the previous number to decide roll direction (state-during-render pattern)
  const [prev, setPrev] = useState(numeric);
  const [dirUp, setDirUp] = useState(true);
  if (numeric !== prev) {
    setDirUp(numeric === undefined || prev === undefined || numeric >= prev);
    setPrev(numeric);
  }
  const d = dirUp ? 1 : -1;
  const entering = () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 14 * d }] },
      animations: {
        opacity: withTiming(1, { duration: 200 }),
        transform: [{ translateY: withSpring(0, { damping: 16, stiffness: 260 }) }],
      },
    };
  };
  const exiting = () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: {
        opacity: withTiming(0, { duration: 160 }),
        transform: [{ translateY: withTiming(-14 * d, { duration: 180 }) }],
      },
    };
  };
  return (
    <View style={{ overflow: 'hidden' }}>
      <Text style={[style, { opacity: 0 }]}>{text}</Text>
      <Animated.Text key={text} entering={entering} exiting={exiting} style={[style, { position: 'absolute', left: 0, top: 0 }]}>
        {text}
      </Animated.Text>
    </View>
  );
}

/* ---------- One shared clock so all cards flip their savings line in sync ---------- */
const listeners = new Set<(n: number) => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
export function useTicker() {
  const [n, setN] = useState(tick);
  useEffect(() => {
    listeners.add(setN);
    if (!timer) timer = setInterval(() => { tick++; listeners.forEach((l) => l(tick)); }, 2600);
    return () => {
      listeners.delete(setN);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  return n;
}

/**
 * The reference's "eyes" mark: outlined eyes that pop into heart-eyes a moment after they
 * appear (and stay). `still` shows the heart-eyes straight away. Height is about 1.33 x size.
 */
export function Hearts({ size = 12, still, color = C.pink }: { size?: number; still?: boolean; color?: string }) {
  const h = Math.round(size * 1.33);
  const v = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) v.value = withDelay(500, withTiming(1, { duration: 260, easing: Easing.out(Easing.back(3)) }));
  }, []);
  return <EyesPop h={h} color={color} v={v} />;
}

/** Eyes -> heart-eyes, driven by `v` (0 -> 1) with a small scale pop as the hearts land. */
function EyesPop({ h, color, v, pupil }: { h: number; color: string; v: SharedValue<number>; pupil?: string }) {
  const eyes = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, v.value) }));
  const love = useAnimatedStyle(() => ({ opacity: Math.min(1, v.value), transform: [{ scale: 0.7 + 0.3 * v.value }] }));
  return (
    <View style={{ width: h * 1.45, height: h }}>
      <Animated.View style={[StyleSheet.absoluteFill, eyes]}><HeartsIcon size={h} color={color} pupil={pupil} /></Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, love]}><HeartsIcon size={h} color={color} filled /></Animated.View>
    </View>
  );
}

/**
 * The card's price footer. When an offer is running AND Admin's "show offer savings"
 * switch is on, it flips between "Offer price" and "You save LKR n" like the original
 * card footer. Otherwise it is static text. Both lines are always mounted and driven by
 * one app-wide UI-thread clock, so the flip costs no React renders on any number of cards.
 */
export function PriceTicker({ product, showSavings, forceSave }: { product: Product; showSavings: boolean; forceSave?: boolean }) {
  useEffect(startClocks, []);
  const offer = isOfferActive(product);
  const save = savingsPerUnit(product);
  const flips = offer && showSavings && save > 0;
  const forced = useSharedValue(forceSave ? 1 : 0);
  useEffect(() => {
    forced.set(withTiming(forceSave ? 1 : 0, { duration: 220 }));
  }, [forceSave]);
  const ours = useAnimatedStyle(() => {
    const v = flips ? Math.max(flip.value, forced.value) : 0;
    return { opacity: v, transform: [{ translateY: (1 - v) * 12 }] };
  });
  const other = useAnimatedStyle(() => {
    const v = flips ? Math.max(flip.value, forced.value) : 0;
    return { opacity: 1 - v, transform: [{ translateY: -v * 12 }] };
  });
  if (!offer) return <View style={styles.ticker} />;
  return (
    <View style={styles.ticker}>
      <Animated.View style={[styles.tickRow, other]}>
        <Hearts size={10} still />
        <Text numberOfLines={1} style={[styles.tickTxt, { color: C.pink, fontFamily: F.semi }]}>Offer price</Text>
      </Animated.View>
      {flips && (
        <Animated.View style={[styles.tickRow, ours]}>
          <Hearts size={10} still />
          <Text numberOfLines={1} style={[styles.tickTxt, { color: C.pink, fontFamily: F.semi }]}>You save {formatLkr(save)}</Text>
        </Animated.View>
      )}
    </View>
  );
}

/* ---------- "+"  →  "− 1 +" stepper (width springs open) ---------- */
export function AddButton({ product, compact, big }: { product: Product; compact?: boolean; big?: boolean }) {
  const id = product.id;
  const q = useCartSelect((c) => c.qty[id] ?? 0);
  const { add, remove } = cartActions;
  const open = useSharedValue(q > 0 ? 1 : 0);
  const pop = useSharedValue(1);
  const fill = useSharedValue(q > 0 ? 1 : 0);
  // big: the reference's dish-card "+" (33 pt circle) that opens leftwards into a 96 pt "− 1 +".
  const W = big ? 96 : compact ? 76 : 84;
  const H = big ? 32 : compact ? 26 : 28;
  useEffect(() => {
    // big (the reference's dish card, 0:30.8): the pill snaps open leftwards in ~100 ms and
    // the "−" and count fade in behind it; the others keep the springy open
    open.value = big
      ? withTiming(q > 0 ? 1 : 0, { duration: 110, easing: Easing.out(Easing.quad) })
      : withSpring(q > 0 ? 1 : 0, { damping: 15, stiffness: 220 });
    fill.value = q > 0 ? withDelay(big ? 60 : 0, withTiming(1, { duration: big ? 220 : 160 })) : withTiming(0, { duration: 120 });
  }, [q > 0]);
  const box = useAnimatedStyle(() => ({
    width: interpolate(open.value, [0, 1], [H, W]),
    transform: [{ scale: pop.value }],
  }));
  const plusOnly = useAnimatedStyle(() => (big
    ? { opacity: 1 - open.value }
    : { opacity: 1 - open.value, transform: [{ rotate: `${open.value * 90}deg` }] }));
  const stepper = useAnimatedStyle(() => ({ opacity: big ? (open.value > 0.02 ? 1 : 0) : open.value }));
  const inner = useAnimatedStyle(() => ({ opacity: big ? fill.value : 1 }));
  const bump = () => {
    pop.set(withSequence(withTiming(1.12, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 300 })));
    tap();
  };
  return (
    <Animated.View style={[styles.add, { height: H, borderRadius: H / 2 }, big && styles.addBig, box]}>
      <Animated.View pointerEvents={q > 0 ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, styles.center, plusOnly]}>
        <Pressable
          hitSlop={8}
          onPress={() => { bump(); add(product); }}
          style={({ pressed }) => [StyleSheet.absoluteFill, styles.center, big && pressed && { backgroundColor: 'rgba(0,0,0,0.12)' }]}
        >
          {big ? <PlusGlyph size={14} /> : <Text style={styles.plus}>+</Text>}
        </Pressable>
      </Animated.View>
      <Animated.View pointerEvents={q > 0 ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.stepRow, big && { paddingHorizontal: 5 }, stepper]}>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'space-between', paddingLeft: 3, paddingRight: 17 }, inner]}>
          <Pressable hitSlop={6} onPress={() => { tap(); remove(id); }} style={styles.stepBtn}>
            <Text style={[styles.stepTxt, big && styles.stepTxtBig]}>−</Text>
          </Pressable>
          <RollingText text={String(Math.max(q, 1))} numeric={q} style={[styles.qty, big && styles.qtyBig]} />
        </Animated.View>
        <Pressable hitSlop={6} onPress={() => { bump(); add(product); }} style={styles.stepBtn}>
          {big ? <PlusGlyph size={11} /> : <Text style={styles.stepTxt}>+</Text>}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/** Thin geometric "+" (the reference's add button draws it, it is not a font glyph). */
function PlusGlyph({ size, color = C.pink }: { size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Path d="M7 1v12M1 7h12" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * The reference's dish-card footer: "Other apps: ₹199–209" first, then, a moment after the
 * card comes into view, it rolls up into "Our app: 50% lower" and stays there. In the cart
 * (`forceSave`) it shows "Our app" straight away.
 */
export function DemoTicker({ other, lowerPct, seen = true, forceSave, money, delay = 1600 }: {
  other?: [number, number]; lowerPct?: number; seen?: boolean; forceSave?: boolean;
  money: (n: number) => string; delay?: number;
}) {
  const v = useSharedValue(forceSave ? 1 : 0);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!seen || flipped || !lowerPct) return;
    const t = setTimeout(() => setFlipped(true), delay);
    return () => clearTimeout(t);
  }, [seen, flipped, lowerPct, delay]);
  useEffect(() => {
    v.set(withTiming(flipped || forceSave ? 1 : 0, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, [flipped, forceSave]);
  const otherA = useAnimatedStyle(() => ({ opacity: 1 - v.value, transform: [{ translateY: -v.value * 18 }] }));
  const oursA = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 18 }] }));
  if (!other && !lowerPct) return <View style={styles.dTicker} />;
  return (
    <View style={styles.dTicker}>
      {other && (
        <Animated.View style={[styles.dRow, otherA]}>
          <HeartsIcon size={13} color="#8A8A8F" pupil="#6A6A70" />
          <Text numberOfLines={1} style={styles.dOther}>Other apps: {money(other[0])}–{money(other[1]).replace('₹', '')}</Text>
        </Animated.View>
      )}
      {!!lowerPct && (
        <Animated.View style={[styles.dRow, oursA]}>
          <EyesPop h={13} color={C.pink} v={v} />
          <Text numberOfLines={1} style={styles.dOurs}>Our app: {lowerPct}% lower</Text>
        </Animated.View>
      )}
    </View>
  );
}

/* ---------- Rotating "FREE DELIVERY" rubber stamp ---------- */
/** Only shown while Blynk's free deliveries are switched on; callers hide it otherwise. */
export function StampBadge({ size = 58, style, variant = 'lowest' }: {
  size?: number; style?: StyleProp<ViewStyle>;
  /** 'lowest' (default): the reference's "EVERYDAY - LOWEST PRICE - EVERYDAY" stamp. 'free': Blynk's free-delivery stamp. */
  variant?: 'free' | 'lowest';
}) {
  useEffect(startClocks, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${-18 + sway.value * 8}deg` }, { scale: 1 + sway.value * 0.04 }] }));
  const R = 24;
  if (variant === 'lowest') {
    return (
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: size, height: size, opacity: 0.32 }, style, a]} pointerEvents="none">
        <Svg width={size} height={size} viewBox="0 0 64 64">
          <Defs>
            <Path id="stTop" d="M 7.5 32 A 24.5 24.5 0 0 1 56.5 32" />
            <Path id="stBot" d="M 6 32 A 26 26 0 0 0 58 32" />
          </Defs>
          <Circle cx={32} cy={32} r={30.5} stroke={C.pink} strokeWidth={1.3} fill="none" />
          <Circle cx={32} cy={32} r={18.5} stroke={C.pink} strokeWidth={1} fill="none" />
          <SvgText fill={C.pink} fontSize={7.4} fontWeight="bold" letterSpacing={1.1} textAnchor="middle">
            <TextPath href="#stTop" startOffset="50%">EVERYDAY</TextPath>
          </SvgText>
          <SvgText fill={C.pink} fontSize={7.4} fontWeight="bold" letterSpacing={1.1} textAnchor="middle">
            <TextPath href="#stBot" startOffset="50%">EVERYDAY</TextPath>
          </SvgText>
          <Path d="M 1 25.5 L 63 25.5 L 60 32 L 63 38.5 L 1 38.5 L 4 32 Z" fill={C.pink} />
          <SvgText x={32} y={34.6} fill="#fff" fontSize={7.6} fontWeight="bold" textAnchor="middle" letterSpacing={0.3}>LOWEST PRICE</SvgText>
        </Svg>
      </Animated.View>
    );
  }
  return (
    <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: size, height: size, opacity: 0.55 }, style, a]} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <Path id="arc" d={`M ${32 - R} 32 a ${R} ${R} 0 1 1 ${2 * R} 0 a ${R} ${R} 0 1 1 ${-2 * R} 0`} />
        </Defs>
        <Circle cx={32} cy={32} r={30} stroke={C.pink} strokeWidth={1.5} fill="none" strokeDasharray="3 2" />
        <Circle cx={32} cy={32} r={18} stroke={C.pink} strokeWidth={1} fill="none" />
        <SvgText fill={C.pink} fontSize={7} fontWeight="bold" letterSpacing={1.2}>
          <TextPath href="#arc">FREE • DELIVERY • BLYNK •</TextPath>
        </SvgText>
        <SvgText x={32} y={30} fill={C.pink} fontSize={7} fontWeight="bold" textAnchor="middle">FREE</SvgText>
        <SvgText x={32} y={39} fill={C.pink} fontSize={5.6} fontWeight="bold" textAnchor="middle">DELIVERY</SvgText>
      </Svg>
    </Animated.View>
  );
}

/* ---------- Confetti burst (physics: initial velocity + gravity) ---------- */
const CONFETTI_COLORS = [C.pink, C.yellow, '#3B82F6', C.green, '#FF6B35', C.purpleLight];
function Piece({ seed, originX, originY }: { seed: number; originX: number; originY: number }) {
  const p = useSharedValue(0);
  const rnd = (k: number) => {
    const x = Math.sin(seed * 9301 + k * 49297) * 233280;
    return x - Math.floor(x);
  };
  const angle = -Math.PI / 2 + (rnd(1) - 0.5) * Math.PI * 1.1;
  const speed = 380 + rnd(2) * 420;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const spin = (rnd(3) - 0.5) * 1440;
  const color = CONFETTI_COLORS[Math.floor(rnd(4) * CONFETTI_COLORS.length)];
  const w = 6 + rnd(5) * 5;
  const round = rnd(6) > 0.6;
  useEffect(() => {
    p.value = withTiming(1, { duration: 1500, easing: Easing.linear });
  }, []);
  const a = useAnimatedStyle(() => {
    const t = p.value * 1.5;
    return {
      opacity: interpolate(p.value, [0, 0.75, 1], [1, 1, 0]),
      transform: [
        { translateX: originX + vx * t * 0.85 },
        { translateY: originY + vy * t + 0.5 * 900 * t * t },
        { rotate: `${spin * p.value}deg` },
        { rotateX: `${spin * 0.6 * p.value}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', left: 0, top: 0, width: w, height: round ? w : w * 0.5, borderRadius: round ? w : 1, backgroundColor: color }, a]}
    />
  );
}

export function Confetti({ burstKey, x, y, count = 34 }: { burstKey: number; x: number; y: number; count?: number }) {
  if (!burstKey) return null;
  return (
    <View key={burstKey} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Piece key={i} seed={burstKey * 100 + i} originX={x} originY={y} />
      ))}
    </View>
  );
}

/* ---------- Bobbing dark tooltip ---------- */
export function Tooltip({ text, onClose, arrow = 'down', style }: { text: string; onClose?: () => void; arrow?: 'up' | 'down'; style?: StyleProp<ViewStyle> }) {
  const b = useSharedValue(0);
  useEffect(() => {
    b.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: (arrow === 'down' ? -1 : 1) * b.value * 4 }] }));
  const tri = <View style={[styles.tri, arrow === 'up' ? { borderBottomColor: C.ink, borderBottomWidth: 7 } : { borderTopColor: C.ink, borderTopWidth: 7 }]} />;
  return (
    <Animated.View style={[{ alignItems: 'center' }, style, a]}>
      {arrow === 'up' && tri}
      <View style={styles.tip}>
        <Text style={styles.tipTxt}>{text}</Text>
        {onClose && (
          <Pressable hitSlop={10} onPress={onClose} style={styles.tipX}>
            <CloseIcon size={8} color={C.ink} stroke={3.2} />
          </Pressable>
        )}
      </View>
      {arrow === 'down' && tri}
    </Animated.View>
  );
}

/* ---------- Chevron that rotates with an open flag ---------- */
export function Chevron({ open, color = C.sub, size = 16 }: { open: boolean; color?: string; size?: number }) {
  const r = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    r.value = withSpring(open ? 1 : 0, { damping: 14, stiffness: 180 });
  }, [open]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 180}deg` }] }));
  return (
    <Animated.View style={a}>
      <ChevronIcon size={size} color={color} />
    </Animated.View>
  );
}

/* ---------- Height-animated accordion body ---------- */
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const measured = useSharedValue(0);
  const p = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(open ? 1 : 0, { duration: 320, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }, [open]);
  const a = useAnimatedStyle(() => ({ height: measured.value * p.value, opacity: interpolate(p.value, [0, 0.4, 1], [0, 0.6, 1]) }));
  return (
    <Animated.View style={[{ overflow: 'hidden' }, a]}>
      <View
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(e) => {
          measured.set(e.nativeEvent.layout.height);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** Pulsing ring used for "you are here" dots and live indicators. */
export function Pulse({ size, color, style }: { size: number; color: string; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - p.value), transform: [{ scale: 0.4 + p.value * 0.9 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style, a]} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  add: {
    backgroundColor: C.white,
    borderWidth: 1.2,
    borderColor: C.pink,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addBig: { borderWidth: 1.4, shadowOpacity: 0.16, shadowRadius: 5 },
  plus: { color: C.pink, fontSize: 18, lineHeight: 20, fontFamily: F.bold, marginTop: -1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  stepBtn: { width: 22, alignItems: 'center' },
  stepTxt: { color: C.pink, fontSize: 16, fontFamily: F.bold },
  qty: { color: C.pink, fontSize: 13, fontFamily: F.bold },
  stepTxtBig: { fontSize: 18, fontFamily: F.medium, lineHeight: 20 },
  qtyBig: { fontSize: 13, fontFamily: F.medium, color: C.pink },
  dTicker: { height: 16, overflow: 'hidden', alignSelf: 'stretch', marginTop: 5 },
  dRow: { position: 'absolute', left: 0, right: 0, top: 0, height: 16, flexDirection: 'row', alignItems: 'center', gap: 3 },
  dOther: { fontSize: 11.5, fontFamily: F.regular, color: '#77777C', flexShrink: 1 },
  dOurs: { fontSize: 12, fontFamily: F.semi, color: C.pink, flexShrink: 1 },
  tri: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  tip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.ink, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 8 },
  tipTxt: { color: C.white, fontSize: 11.5, fontFamily: F.medium },
  ticker: { height: 15, overflow: 'hidden', alignSelf: 'stretch' },
  tickRow: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tickTxt: { fontSize: 10, fontFamily: F.regular, flexShrink: 1 },
  tipX: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ddd', alignItems: 'center', justifyContent: 'center' },
});
