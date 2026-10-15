import { Children, createContext, isValidElement, useContext, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ENTER, enterDelay } from '@/blynk/account/tabHeroes';
import { BackIcon, ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { withSpring } from '@/lib/motion';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';
import { useActive } from '@/lib/useActive';

/* Small shared pieces of the account screens, in the app's look (white cards on the pale grey). */

/** The wash behind a card's row icons (Profile / Help give each section its own; elsewhere the pale grey). */
const ToneContext = createContext<string>(C.bg);

/** `onBack={null}`: no back button (a tab of the shell has nowhere to go back to). */
export function ScreenHeader({ title, top, onBack = goBack }: { title: string; top: number; onBack?: (() => void) | null }) {
  return (
    <View style={[s.head, { paddingTop: top + 8 }, !onBack && { paddingLeft: 17 }]}>
      {onBack && <PressScale onPress={onBack} style={{ padding: 4 }}><BackIcon size={20} color={C.text} stroke={1.8} /></PressScale>}
      <Text style={s.title} accessibilityRole="header">{title}</Text>
    </View>
  );
}

/**
 * A white card of rows. `tone` washes its row icons in one colour. `stagger` (the first row's
 * slot): the card fades in and each row slides in after the one above, once, as the screen first
 * shows (src/blynk/account/tabHeroes.ts ENTER). A row added to the card joins the stagger by itself.
 */
export function Card({ children, style, tone, stagger }: { children: ReactNode; style?: object; tone?: string; stagger?: number }) {
  const body = stagger == null
    ? children
    : Children.toArray(children).map((child, i) => (
      <Enter key={isValidElement(child) && child.key != null ? child.key : i} slot={stagger + i}>{child}</Enter>
    ));
  const card = <View style={[s.card, style]}>{body}</View>;
  const toned = tone ? <ToneContext.Provider value={tone}>{card}</ToneContext.Provider> : card;
  return stagger == null ? toned : <Enter slot={stagger} rise={0}>{toned}</Enter>;
}

/**
 * Fades (and lifts `rise` px) into place after `enterDelay(slot)`, once, when it mounts (a tab
 * mounts on its first focus). Reduced motion: a plain short fade. Opacity / transform only.
 */
export function Enter({ slot, rise = 10, children }: { slot: number; rise?: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(reduced ? 0 : enterDelay(slot), withTiming(1, { duration: reduced ? 180 : ENTER.durationMs, easing: Easing.out(Easing.cubic) }));
  }, []);
  const lift = reduced ? 0 : rise;
  const a = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * lift }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

/**
 * A small green dot that pulses while `on` (the store is open), beside Call / WhatsApp. The pulse
 * runs only while its screen is showing; reduced motion: a still dot.
 */
export function LiveDot({ on, size = 8, label }: { on: boolean; size?: number; label?: string }) {
  const reduced = useReducedMotion();
  const active = useActive();
  const p = useSharedValue(0);
  const run = on && active && !reduced;
  useEffect(() => {
    if (!run) { cancelAnimation(p); p.value = 0; return; }
    p.value = 0;
    p.value = withRepeat(withSequence(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 500 })), -1);
    return () => cancelAnimation(p);
  }, [run]);
  const ring = useAnimatedStyle(() => ({ opacity: p.value > 0 && p.value < 1 ? 0.5 * (1 - p.value) : 0, transform: [{ scale: 1 + 1.6 * p.value }] }));
  if (!on) return null;
  return (
    <View style={{ width: size, height: size }} accessible={!!label} accessibilityLabel={label}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size, backgroundColor: C.green }, ring]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: size, backgroundColor: C.green }]} />
    </View>
  );
}

/**
 * One row: icon tile, title, optional line under it, chevron. On press the emoji gives a small
 * hop and the chevron nudges right (no hop under reduced motion). `live`: a pulsing green dot
 * before the chevron (Help's Call / WhatsApp while the store is open).
 */
export function Row({
  icon, title, sub, onPress, last, danger, right, live, liveLabel,
}: {
  icon?: string; title: string; sub?: string | null; onPress?: () => void; last?: boolean; danger?: boolean; right?: ReactNode;
  live?: boolean; liveLabel?: string;
}) {
  const tone = useContext(ToneContext);
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const onIn = () => { press.value = withSpring(1, { damping: 14, stiffness: 420 }); };
  const onOut = () => { press.value = withSequence(withTiming(1, { duration: 70 }), withSpring(0, { damping: 7, stiffness: 260 })); };
  const hop = reduced ? 0 : 1;
  const iconA = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * hop * press.value }, { scale: 1 + 0.16 * hop * press.value }, { rotate: `${-8 * hop * press.value}deg` }],
  }));
  const chevA = useAnimatedStyle(() => ({ transform: [{ translateX: 3 * press.value }, { rotate: '-90deg' }] }));
  return (
    <PressScale onPress={onPress} disabled={!onPress} scaleTo={0.985} style={[s.row, !last && s.rowLine]} onPressIn={onPress ? onIn : undefined} onPressOut={onPress ? onOut : undefined}>
      {!!icon && <View style={[s.iconBox, { backgroundColor: tone }]}><Animated.Text style={[s.icon, iconA]}>{icon}</Animated.Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, danger && { color: C.problem }]}>{title}</Text>
        {!!sub && <Text style={s.rowSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {!!live && <LiveDot on label={liveLabel} />}
      {right ?? (onPress ? <Animated.View style={chevA}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></Animated.View> : null)}
    </PressScale>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={s.section}>{children}</Text>;
}

export function Button({
  label, onPress, kind = 'primary', busy, disabled, style,
}: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; style?: object }) {
  const bg = kind === 'primary' ? C.brand : kind === 'danger' ? C.problem : '#fff';
  const fg = kind === 'danger' ? '#fff' : C.brandInk;
  return (
    <PressScale
      onPress={busy || disabled ? undefined : onPress}
      disabled={busy || disabled}
      haptic
      scaleTo={0.97}
      style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === 'secondary' && s.btnSecondary, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnTxt, { color: fg }]}>{label}</Text>}
    </PressScale>
  );
}

/** A bottom sheet over a dimmed screen (the app's login sheet look). */
export function Sheet({ children, onClose, label }: { children: ReactNode; onClose?: () => void; label: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={s.backdrop} accessibilityViewIsModal accessibilityLabel={label}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View entering={SlideInDown.duration(260)} exiting={SlideOutDown.duration(180)} style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

export function ErrorText({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <Text style={s.err} accessibilityRole="alert">{children}</Text>;
}

export const accountStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { fontFamily: F.regular, fontSize: 13.5, color: C.sub, lineHeight: 19 },
  heading: { fontFamily: F.bold, fontSize: 16, color: C.ink },
  sheetTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, marginBottom: 10 },
  label: { fontFamily: F.semi, fontSize: 12.5, color: C.sub, marginBottom: 6 },
  input: {
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff',
    paddingHorizontal: 13, fontFamily: F.medium, fontSize: 15, color: C.ink,
  },
  pair: { flexDirection: 'row', gap: 10, marginTop: 18 },
});

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12, backgroundColor: '#fff' },
  title: { fontFamily: F.bold, fontSize: 18, color: C.ink },
  card: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, minHeight: 56, paddingVertical: 10 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  iconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 16 },
  rowTitle: { fontFamily: F.semi, fontSize: 14.5, color: C.ink },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2 },
  section: { fontFamily: F.semi, fontSize: 12, color: C.sub, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 8, marginBottom: 8, marginLeft: 4 },
  btn: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnSecondary: { borderWidth: 1, borderColor: C.line },
  btnTxt: { fontFamily: F.semi, fontSize: 15 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', zIndex: 50 },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 20 },
  err: { fontFamily: F.medium, fontSize: 13, color: C.problem, lineHeight: 18, marginTop: 8 },
});
