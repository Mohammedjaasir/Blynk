import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import Svg, { Circle, Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { cartActions, useCartSelect } from '@/lib/cart';
import { flip, pulse, startClocks, sway } from '@/lib/clock';
import { C, F } from '@/lib/theme';
import { ChevronIcon, CloseIcon } from './icons';

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

/** `still` skips the heartbeat — used on product cards, where dozens would beat at once. */
export function Hearts({ size = 12, still }: { size?: number; still?: boolean }) {
  useEffect(startClocks, []);
  const a = useAnimatedStyle(() => (still ? {} : { transform: [{ scale: pulse.value }] }));
  return (
    <Animated.View style={[{ flexDirection: 'row' }, a]}>
      <Text style={{ fontSize: size, color: C.pink }}>♥</Text>
      <Text style={{ fontSize: size, color: C.pink, marginLeft: -size * 0.35 }}>♥</Text>
    </Animated.View>
  );
}

/**
 * Flips between "Other stores ₹x–y" and "Our app: n% lower" like the original card footer.
 * Both lines are always mounted and driven by one app-wide UI-thread clock, so the
 * flip costs no React renders no matter how many cards are on screen.
 */
export function SavingsTicker({ otherMin, otherMax, pct, forceOurs }: { otherMin: number; otherMax: number; pct: number; forceOurs?: boolean }) {
  useEffect(startClocks, []);
  const forced = useSharedValue(forceOurs ? 1 : 0);
  useEffect(() => {
    forced.set(withTiming(forceOurs ? 1 : 0, { duration: 220 }));
  }, [forceOurs]);
  const ours = useAnimatedStyle(() => {
    const v = Math.max(flip.value, forced.value);
    return { opacity: v, transform: [{ translateY: (1 - v) * 12 }] };
  });
  const other = useAnimatedStyle(() => {
    const v = Math.max(flip.value, forced.value);
    return { opacity: 1 - v, transform: [{ translateY: -v * 12 }] };
  });
  return (
    <View style={styles.ticker}>
      <Animated.View style={[styles.tickRow, other]}>
        <Text style={{ fontSize: 9, color: C.faint }}>👀</Text>
        <Text numberOfLines={1} style={[styles.tickTxt, { color: C.sub }]}>Other stores: ₹{otherMin}–{otherMax}</Text>
      </Animated.View>
      <Animated.View style={[styles.tickRow, ours]}>
        <Hearts size={10} still />
        <Text numberOfLines={1} style={[styles.tickTxt, { color: C.pink, fontFamily: F.semi }]}>Our app: {pct}% lower</Text>
      </Animated.View>
    </View>
  );
}

/* ---------- "+"  →  "− 1 +" stepper (width springs open) ---------- */
export function AddButton({ id, storeId, compact }: { id: string; storeId?: string; compact?: boolean }) {
  const q = useCartSelect((c) => c.qty[id] ?? 0);
  const { add, remove } = cartActions;
  const open = useSharedValue(q > 0 ? 1 : 0);
  const pop = useSharedValue(1);
  const W = compact ? 76 : 84;
  const H = compact ? 26 : 28;
  useEffect(() => {
    open.value = withSpring(q > 0 ? 1 : 0, { damping: 15, stiffness: 220 });
  }, [q > 0]);
  const box = useAnimatedStyle(() => ({
    width: interpolate(open.value, [0, 1], [H, W]),
    transform: [{ scale: pop.value }],
  }));
  const plusOnly = useAnimatedStyle(() => ({ opacity: 1 - open.value, transform: [{ rotate: `${open.value * 90}deg` }] }));
  const stepper = useAnimatedStyle(() => ({ opacity: open.value }));
  const bump = () => {
    pop.set(withSequence(withTiming(1.12, { duration: 90 }), withSpring(1, { damping: 8, stiffness: 300 })));
    tap();
  };
  return (
    <Animated.View style={[styles.add, { height: H, borderRadius: H / 2 }, box]}>
      <Animated.View pointerEvents={q > 0 ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, styles.center, plusOnly]}>
        <Pressable hitSlop={8} onPress={() => { bump(); add(id, storeId); }} style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={styles.plus}>+</Text>
        </Pressable>
      </Animated.View>
      <Animated.View pointerEvents={q > 0 ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.stepRow, stepper]}>
        <Pressable hitSlop={6} onPress={() => { tap(); remove(id); }} style={styles.stepBtn}>
          <Text style={styles.stepTxt}>−</Text>
        </Pressable>
        <RollingText text={String(Math.max(q, 1))} numeric={q} style={styles.qty} />
        <Pressable hitSlop={6} onPress={() => { bump(); add(id, storeId); }} style={styles.stepBtn}>
          <Text style={styles.stepTxt}>+</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/* ---------- Rotating "EVERYDAY LOWEST PRICE" rubber stamp ---------- */
export function StampBadge({ size = 58, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  useEffect(startClocks, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${-18 + sway.value * 8}deg` }, { scale: 1 + sway.value * 0.04 }] }));
  const R = 24;
  return (
    <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: size, height: size, opacity: 0.55 }, style, a]} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <Path id="arc" d={`M ${32 - R} 32 a ${R} ${R} 0 1 1 ${2 * R} 0 a ${R} ${R} 0 1 1 ${-2 * R} 0`} />
        </Defs>
        <Circle cx={32} cy={32} r={30} stroke={C.pink} strokeWidth={1.5} fill="none" strokeDasharray="3 2" />
        <Circle cx={32} cy={32} r={18} stroke={C.pink} strokeWidth={1} fill="none" />
        <SvgText fill={C.pink} fontSize={7} fontWeight="bold" letterSpacing={1.2}>
          <TextPath href="#arc">EVERYDAY • LOWEST • PRICE •</TextPath>
        </SvgText>
        <SvgText x={32} y={30} fill={C.pink} fontSize={7} fontWeight="bold" textAnchor="middle">LOWEST</SvgText>
        <SvgText x={32} y={39} fill={C.pink} fontSize={7} fontWeight="bold" textAnchor="middle">PRICE</SvgText>
      </Svg>
    </Animated.View>
  );
}

/* ---------- Confetti burst (physics: initial velocity + gravity) ---------- */
const CONFETTI_COLORS = [C.pink, C.yellow, '#3B82F6', C.green, '#FF6B35', '#9B5DE5'];
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
  plus: { color: C.pink, fontSize: 18, lineHeight: 20, fontFamily: F.bold, marginTop: -1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  stepBtn: { width: 22, alignItems: 'center' },
  stepTxt: { color: C.pink, fontSize: 16, fontFamily: F.bold },
  qty: { color: C.pink, fontSize: 13, fontFamily: F.bold },
  tri: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  tip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.ink, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 8 },
  tipTxt: { color: C.white, fontSize: 11.5, fontFamily: F.medium },
  ticker: { height: 15, overflow: 'hidden', alignSelf: 'stretch' },
  tickRow: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tickTxt: { fontSize: 10, fontFamily: F.regular, flexShrink: 1 },
  tipX: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ddd', alignItems: 'center', justifyContent: 'center' },
});
