import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon, ChevronIcon, StarIcon } from '@/components/icons';
import { PressScale, Skeleton } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * The plain building blocks of the catalog-extras, rewards and doctors screens, in the look the
 * orders screens already use: a white header with back and a bold title over the grey page,
 * white 16-radius cards, the yellow pill for the one forward action.
 */

/** White header (back + title + an optional action) over a grey page. */
export function Page({ title, right, children, footer, scroll = true, onBack, bg = C.bg }: {
  title: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; onBack?: () => void; bg?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar style="dark" />
      <View style={[k.head, { paddingTop: insets.top + 8 }]}>
        <PressScale onPress={onBack ?? goBack} style={{ padding: 4 }}>
          <BackIcon size={20} color={C.text} stroke={1.8} />
        </PressScale>
        <Text style={k.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {right}
      </View>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 15, paddingBottom: (footer ? 24 : insets.bottom + 40) }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer ? <View style={[k.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View> : null}
    </View>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  if (!onPress) return <View style={[k.card, style]}>{children}</View>;
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={[k.card, style]}>
      <View accessible accessibilityRole="button" accessibilityLabel={label}>{children}</View>
    </PressScale>
  );
}

export const Chevron = () => (
  <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
);

export const SectionTitle = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={style}><Text style={k.section} accessibilityRole="header">{children}</Text></View>
);

/** A small grey label over its value. */
export const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <View><Text style={k.factLabel}>{label}</Text>{typeof children === 'string' ? <Text style={k.body}>{children}</Text> : children}</View>
);

export const Body = ({ children, sub, style }: { children: ReactNode; sub?: boolean; style?: object }) => (
  <Text style={[sub ? k.sub : k.body, style]}>{children}</Text>
);

const TONES = {
  positive: { bg: C.greenTint, fg: C.greenDark },
  notice: { bg: C.brandTint, fg: C.brandText },
  neutral: { bg: '#EFEFF3', fg: C.sub },
  problem: { bg: '#FBE9E7', fg: C.problem },
} as const;
export type Tone = keyof typeof TONES;

export const Badge = ({ tone, label }: { tone: Tone; label: string }) => (
  <View style={[k.badge, { backgroundColor: TONES[tone].bg }]}><Text style={[k.badgeTxt, { color: TONES[tone].fg }]}>{label}</Text></View>
);

/** The notice tint box ("Reserved for 4:59", "This time was just booked"). */
export const Notice = ({ children, tone = 'notice' }: { children: ReactNode; tone?: Tone }) => (
  <Animated.View entering={FadeIn.duration(160)} style={[k.notice, { backgroundColor: TONES[tone].bg }]} accessibilityLiveRegion="polite">
    <Text style={[k.noticeTxt, { color: TONES[tone].fg }]}>{children}</Text>
  </Animated.View>
);

type BtnKind = 'primary' | 'secondary' | 'destructive' | 'quiet';
export function Button({ label, onPress, kind = 'primary', busy, disabled, style, small }: {
  label: string; onPress?: () => void; kind?: BtnKind; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const off = disabled || busy;
  const box = [
    k.btn, small && k.btnSmall,
    kind === 'primary' && { backgroundColor: off ? C.brandSoft : C.brand },
    kind === 'secondary' && { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.ink },
    kind === 'destructive' && { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.problem },
    kind === 'quiet' && { backgroundColor: 'transparent' },
    disabled && kind !== 'primary' && { opacity: 0.5 },
  ];
  const color = kind === 'destructive' ? C.problem : kind === 'quiet' ? C.brandText : C.brandInk;
  return (
    <PressScale onPress={onPress} disabled={off} haptic={kind === 'primary'} scaleTo={0.96} style={style}>
      <View style={box} accessible accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }}>
        {busy ? <ActivityIndicator color={color} /> : <Text style={[k.btnTxt, small && { fontSize: 13.5 }, { color }]}>{label}</Text>}
      </View>
    </PressScale>
  );
}

/** Label, boxed input, then the error or helper line. */
export function Field({ label, value, onChange, error, helper, prefix, multiline, maxLength, counter, ...rest }: {
  label: string; value: string; onChange: (t: string) => void; error?: string | null; helper?: string; prefix?: string;
  multiline?: boolean; maxLength?: number; counter?: boolean;
} & Omit<TextInputProps, 'value' | 'onChange' | 'onChangeText' | 'multiline' | 'maxLength'>) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={k.factLabel}>{label}</Text>
      <View style={[k.input, multiline && { height: undefined, minHeight: 84, alignItems: 'flex-start', paddingVertical: 10 }, focus && { borderColor: C.ink }, !!error && { borderColor: C.problem }]}>
        {prefix ? <Text style={k.prefix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          multiline={multiline}
          maxLength={maxLength}
          placeholderTextColor="#B4B4BC"
          accessibilityLabel={label}
          style={[k.inputTxt, multiline && { textAlignVertical: 'top', minHeight: 64 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          {...rest}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {error ? <Text style={k.err} accessibilityRole="alert">{error}</Text> : helper ? <Text style={k.helper}>{helper}</Text> : <View />}
        {counter && maxLength ? <Text style={k.helper}>{value.length} / {maxLength}</Text> : null}
      </View>
    </View>
  );
}

/** A centred empty / error / sign-in state. */
export function StateView({ title, message, action, onAction, secondary, onSecondary }: {
  title: string; message?: string | null; action?: string; onAction?: () => void; secondary?: string; onSecondary?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={k.state}>
      <Text style={k.stateTitle} accessibilityRole="header">{title}</Text>
      {message ? <Text style={k.stateSub}>{message}</Text> : null}
      {action && onAction ? <Button label={action} onPress={onAction} style={{ marginTop: 20, minWidth: 180 }} /> : null}
      {secondary && onSecondary ? <Button label={secondary} kind="quiet" onPress={onSecondary} style={{ marginTop: 6 }} small /> : null}
    </Animated.View>
  );
}

export const ListSkeleton = ({ rows = 4, h = 84 }: { rows?: number; h?: number }) => (
  <View>{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={h} r={16} style={{ marginBottom: 12 }} />)}</View>
);

/** Five read-only stars. */
export const Stars = ({ stars, size = 16 }: { stars: number; size?: number }) => (
  <View style={{ flexDirection: 'row', gap: 3 }} accessible accessibilityLabel={`Rated ${stars} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((s) => <StarIcon key={s} size={size} color={s <= stars ? C.ink : '#D5D5DC'} />)}
  </View>
);

/** A short message at the bottom of the screen for a few seconds. */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const show = (m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 3200);
  };
  const node = msg ? <Toast key={msg} text={msg} /> : null;
  return [node, show];
}

export function Toast({ text, top }: { text: string; top?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(180)}
      pointerEvents="none"
      style={[k.toast, top != null ? { top: insets.top + top } : { bottom: insets.bottom + 100 }]}
      accessibilityRole="alert"
    >
      <Text style={k.toastTxt}>{text}</Text>
    </Animated.View>
  );
}

export const k = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12, backgroundColor: '#fff' },
  title: { flex: 1, fontFamily: F.bold, fontSize: 18, color: C.ink },
  footer: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 15, paddingTop: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 15, marginBottom: 12 },
  section: { fontFamily: F.bold, fontSize: 16, color: C.ink, marginBottom: 10 },
  factLabel: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginBottom: 4 },
  body: { fontFamily: F.regular, fontSize: 14, color: C.text, lineHeight: 20 },
  sub: { fontFamily: F.regular, fontSize: 13, color: C.sub, lineHeight: 18 },
  badge: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontFamily: F.semi, fontSize: 12 },
  notice: { borderRadius: 12, padding: 12, marginBottom: 12 },
  noticeTxt: { fontFamily: F.semi, fontSize: 13.5, lineHeight: 19 },
  btn: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  btnSmall: { height: 40, borderRadius: 20, paddingHorizontal: 16 },
  btnTxt: { fontFamily: F.semi, fontSize: 15.5 },
  input: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 12, borderWidth: 1.2, borderColor: '#DCDCE0', backgroundColor: '#fff', paddingHorizontal: 12, gap: 8 },
  inputTxt: { flex: 1, fontFamily: F.medium, fontSize: 15, color: C.ink, paddingVertical: 0 },
  prefix: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  err: { fontFamily: F.medium, fontSize: 12, color: C.problem, marginTop: 5, flex: 1 },
  helper: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 5 },
  state: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 20 },
  stateTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, textAlign: 'center' },
  stateSub: { fontFamily: F.regular, fontSize: 13.5, color: C.sub, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  toast: { position: 'absolute', left: 24, right: 24, backgroundColor: C.ink, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 80 },
  toastTxt: { color: '#fff', fontFamily: F.semi, fontSize: 13.5, textAlign: 'center' },
});
