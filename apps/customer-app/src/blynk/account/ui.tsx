import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon, ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/* Small shared pieces of the account screens, in the app's look (white cards on the pale grey). */

/** `onBack={null}`: no back button (a tab of the shell has nowhere to go back to). */
export function ScreenHeader({ title, top, onBack = goBack }: { title: string; top: number; onBack?: (() => void) | null }) {
  return (
    <View style={[s.head, { paddingTop: top + 8 }, !onBack && { paddingLeft: 17 }]}>
      {onBack && <PressScale onPress={onBack} style={{ padding: 4 }}><BackIcon size={20} color={C.text} stroke={1.8} /></PressScale>}
      <Text style={s.title} accessibilityRole="header">{title}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({
  icon, title, sub, onPress, last, danger, right,
}: { icon?: string; title: string; sub?: string | null; onPress?: () => void; last?: boolean; danger?: boolean; right?: ReactNode }) {
  return (
    <PressScale onPress={onPress} disabled={!onPress} scaleTo={0.985} style={[s.row, !last && s.rowLine]}>
      {!!icon && <View style={s.iconBox}><Text style={s.icon}>{icon}</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, danger && { color: C.problem }]}>{title}</Text>
        {!!sub && <Text style={s.rowSub} numberOfLines={2}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View> : null)}
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
  iconBox: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
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
