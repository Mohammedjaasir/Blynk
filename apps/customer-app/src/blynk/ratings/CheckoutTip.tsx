import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ApiError } from '@/blynk/api/client';
import type { StoreInfo } from '@/blynk/api/types';
import { noteNotReady, useFeatureOn } from '@/blynk/lib/featureGate';
import { formatLkr } from '@/blynk/lib/money';
import type { CheckoutBill } from '@/blynk/orders/checkout';
import type { CheckoutInfo } from '@/blynk/orders/types';
import { tap } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import { checkoutTip, checkoutTipOptions, parseCustomTip, totalWithTip } from './model';
import { TIP_COPY } from './words';

/*
 * "Tip your rider (optional)" at checkout (migration 055): chips No tip / 50 / 100 / 200 (checkout-info
 * `tip_options`) and Other (up to LKR 1,000). The tip is collected in cash with the order, so it shows
 * only while paying cash on delivery; it is added to To Pay and sent as `rider_tip_lkr`. Hidden while
 * GET /store `ratings_enabled` is off, checkout-info sends no options, or the API said RATINGS_NOT_READY.
 */

export interface CheckoutTipCtl {
  visible: boolean;
  options: number[];
  picked: number;
  custom: boolean;
  customText: string;
  customError: string | null;
  /** What goes with the order (0 = none). */
  tip: number;
  pick: (amount: number) => void;
  openCustom: () => void;
  setCustomText: (t: string) => void;
  /** Spread into the POST /orders body (and the idempotency signature). */
  body: { rider_tip_lkr?: number };
  /** The checkout with the tip on top of To Pay (for the Place order button). */
  withTip: (c: CheckoutBill | null) => CheckoutBill | null;
  /** From the place-order catch: a refused tip is taken off so the customer can place again. */
  onPlaceError: (e: unknown) => void;
}

export function useCheckoutTip({ quote, store, cash }: { quote: CheckoutInfo | null; store: StoreInfo | null; cash: boolean }): CheckoutTipCtl {
  const on = useFeatureOn(store, 'ratings');
  const options = DEMO || !on ? [] : checkoutTipOptions(quote?.tip_options);
  const [picked, setPicked] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customText, setText] = useState('');
  const parsed = parseCustomTip(customText);
  const chosen = custom ? parsed.amount : picked;
  const tip = checkoutTip(chosen, { options, cash });
  const visible = options.length > 0 && cash;
  return {
    visible,
    options,
    picked,
    custom,
    customText,
    customError: custom ? parsed.error : null,
    tip,
    pick: (amount) => { setCustom(false); setPicked(amount); },
    openCustom: () => { setCustom(true); setPicked(0); },
    setCustomText: (t) => setText(t.replace(/[^\d]/g, '').slice(0, 4)),
    body: tip > 0 ? { rider_tip_lkr: tip } : {},
    withTip: (c) => (c && tip > 0 ? { ...c, toPay: totalWithTip(c.toPay, tip) } : c),
    onPlaceError: (e) => {
      const refused = noteNotReady(e, 'ratings')
        || (e instanceof ApiError && e.status === 400 && /TIP/i.test(`${e.code ?? ''} ${e.message}`));
      if (refused) { setCustom(false); setPicked(0); setText(''); }
    },
  };
}

/** The card, in the cart's look (white card, the small yellow square, chips). */
export function CheckoutTipRow({ ctl }: { ctl: CheckoutTipCtl }) {
  if (!ctl.visible) return null;
  const chips: { key: string; label: string; on: boolean; onPress: () => void }[] = [
    { key: 'none', label: TIP_COPY.none, on: !ctl.custom && ctl.picked === 0, onPress: () => ctl.pick(0) },
    ...ctl.options.map((a) => ({ key: String(a), label: formatLkr(a), on: !ctl.custom && ctl.picked === a, onPress: () => ctl.pick(a) })),
    { key: 'custom', label: TIP_COPY.custom, on: ctl.custom, onPress: ctl.openCustom },
  ];
  return (
    <Animated.View entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)} style={s.card}>
      <View style={s.head}>
        <View style={s.sq}><HeartGlyph /></View>
        <Text style={s.title}>{TIP_COPY.checkoutTitle}</Text>
        {ctl.tip > 0 && (
          <Animated.Text key={ctl.tip} entering={FadeIn.duration(180)} style={s.amount}>+{formatLkr(ctl.tip)}</Animated.Text>
        )}
      </View>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={TIP_COPY.checkoutTitle}>
        {chips.map((c) => <TipChip key={c.key} label={c.label} on={c.on} onPress={c.onPress} />)}
      </View>
      {ctl.custom && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <View style={[s.inputBox, !!ctl.customError && { borderColor: C.problem }]}>
            <Text style={s.prefix}>LKR</Text>
            <TextInput
              value={ctl.customText}
              onChangeText={ctl.setCustomText}
              keyboardType="number-pad"
              autoFocus
              placeholder={TIP_COPY.customPlaceholder}
              placeholderTextColor="#9A9AA2"
              accessibilityLabel={TIP_COPY.customLabel}
              maxLength={4}
              style={[s.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
            />
          </View>
          {!!ctl.customError && <Text style={s.err} accessibilityRole="alert">{ctl.customError}</Text>}
        </Animated.View>
      )}
      <Text style={s.note}>{ctl.tip > 0 ? TIP_COPY.checkoutNoteThanks : TIP_COPY.checkoutNote}</Text>
    </Animated.View>
  );
}

/** A chip that pops a little when picked. */
export function TipChip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const reduced = useReducedMotion();
  const sc = useSharedValue(1);
  useEffect(() => {
    if (on && !reduced) sc.value = withSequence(withTiming(1.08, { duration: 90, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 9, stiffness: 320 }));
  }, [on]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={a}>
      <Pressable
        onPress={() => { if (disabled) return; tap(); onPress(); }}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled: !!disabled }}
        accessibilityLabel={label}
        style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && { backgroundColor: C.bg }, disabled && { opacity: 0.45 }]}
      >
        <Text style={[s.chipTxt, on && s.chipTxtOn]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const HeartGlyph = () => (
  <Svg width={11} height={11} viewBox="0 0 24 24">
    <Path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" fill={C.brandInk} />
  </Svg>
);

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 13, marginHorizontal: 15, marginBottom: 15 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 1 },
  sq: { width: 18, height: 18, borderRadius: 4.5, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: F.medium, fontSize: 13.5, color: '#333', marginLeft: 11, letterSpacing: -0.1 },
  amount: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { height: 34, borderRadius: 17, paddingHorizontal: 13, borderWidth: 1, borderColor: '#DCDCE2', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.brandTint, borderColor: C.brandDeep, borderWidth: 1.4 },
  chipTxt: { fontFamily: F.medium, fontSize: 13, color: '#4A4A52' },
  chipTxtOn: { fontFamily: F.semi, color: C.brandInk },
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 12, borderWidth: 1.2, borderColor: '#DCDCE0', paddingHorizontal: 12, marginTop: 10 },
  prefix: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  input: { flex: 1, fontFamily: F.medium, fontSize: 15, color: C.ink, paddingVertical: 0 },
  err: { fontFamily: F.medium, fontSize: 12, color: C.problem, marginTop: 5 },
  note: { fontFamily: F.regular, fontSize: 11.5, color: '#7A7A82', marginTop: 10, lineHeight: 16 },
});
