import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/blynk/api/client';
import { saveProfile } from '@/blynk/auth/api';
import { finishSignIn } from '@/blynk/auth/flow';
import { isFromGate } from '@/blynk/auth/gate';
import { authErrorText, parseBirthday } from '@/blynk/auth/forms';
import { PressScale } from '@/components/ui';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

const B = LIVE.birthday;

/*
 * The optional birthday prompt, shown once, right after registration. Same visual language as
 * "Verify Details". "Save birthday" stays pale and disabled until a real date is typed
 * (DD / MM / YYYY, age 5 to 120, never in the future: the backend's rule).
 * Live: PATCH /me {date_of_birth}. Design mock: no network. Both return to the cart (after the
 * start gate's sign-in, `?gate=1`: on to the shop).
 */
export default function Birthday() {
  const insets = useSafeAreaInsets();
  const gate = isFromGate(useLocalSearchParams<{ gate?: string }>().gate);
  const returnToCart = () => finishSignIn(gate);
  const [d, setD] = useState('');
  const [m, setM] = useState('');
  const [y, setY] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const mRef = useRef<TextInput>(null);
  const yRef = useRef<TextInput>(null);
  const date = parseBirthday(d, m, y);
  const complete = d.length > 0 && m.length > 0 && y.length === 4;
  const bad = complete && !date;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const en = useSharedValue(0);
  useEffect(() => { en.value = withTiming(date ? 1 : 0, { duration: 200 }); }, [date]);
  const btn = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(en.value, [0, 1], [C.brandSoft, C.brand]) }));

  const save = async () => {
    if (!date || busy) return;
    Keyboard.dismiss();
    if (DEMO) { returnToCart(); return; }
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ date_of_birth: date });
      returnToCart();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') { returnToCart(); return; }
      setError(e instanceof ApiError && e.code === 'VALIDATION_ERROR' ? B.bad : authErrorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const skip = () => {
    if (busy) return;
    Keyboard.dismiss();
    returnToCart();
  };

  const digits = (t: string, n: number) => t.replace(/\D/g, '').slice(0, n);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <Text style={styles.title}>{B.title}</Text>
        <GiftArt />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: insets.bottom + 30 }}>
        <Text style={styles.body}>{B.body}</Text>

        <View style={styles.row}>
          <Part label={B.day} value={d} width={45} autoFocus
            onChange={(t) => { const v = digits(t, 2); setD(v); setError(null); if (v.length === 2) mRef.current?.focus(); }} />
          <Text style={styles.slash}>/</Text>
          <Part inputRef={mRef} label={B.month} value={m} width={45}
            onChange={(t) => { const v = digits(t, 2); setM(v); setError(null); if (v.length === 2) yRef.current?.focus(); }} />
          <Text style={styles.slash}>/</Text>
          <Part inputRef={yRef} label={B.year} value={y} width={78} onSubmit={() => void save()}
            onChange={(t) => { setY(digits(t, 4)); setError(null); }} />
        </View>

        <View style={styles.errorBox}>
          {(bad || !!error) && <Text style={styles.error} accessibilityRole="alert">{error ?? B.bad}</Text>}
        </View>

        <PressScale onPress={() => void save()} disabled={!date || busy} haptic scaleTo={0.96}>
          <Animated.View style={[styles.cta, btn]}>
            <Text style={styles.ctaTxt}>{busy ? B.saving : B.save}</Text>
          </Animated.View>
        </PressScale>
        <Pressable onPress={skip} style={styles.skip} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.skipTxt}>{B.skip}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** One date part: digits over an underline that darkens while focused; the placeholder names the part. */
function Part({
  label, value, onChange, width, inputRef, autoFocus, onSubmit,
}: {
  label: string; value: string; onChange: (t: string) => void; width: number;
  inputRef?: RefObject<TextInput | null>; autoFocus?: boolean; onSubmit?: () => void;
}) {
  const [focus, setFocus] = useState(false);
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(focus ? 1 : 0, { duration: 150 }); }, [focus]);
  const line = useAnimatedStyle(() => ({
    height: 1 + w.value * 1.6,
    backgroundColor: interpolateColor(w.value, [0, 1], ['#DCDCE0', C.brandInk]),
  }));
  return (
    <View style={{ width }}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor="#B4B4BC"
        keyboardType="number-pad"
        maxLength={label.length}
        autoFocus={autoFocus}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onSubmitEditing={onSubmit}
        style={styles.part}
        accessibilityLabel={label}
      />
      <Animated.View style={[{ alignSelf: 'stretch' }, line]} />
    </View>
  );
}

/** Ink outline gift box, cut off by the header's bottom edge (the OTP screen's phone, for a gift). */
function GiftArt() {
  return (
    <View style={styles.gift}>
      <View style={styles.lid} />
      <View style={styles.ribbon} />
      <View style={styles.bowL} />
      <View style={styles.bowR} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.brand, paddingHorizontal: 15, paddingBottom: 23, overflow: 'hidden', minHeight: 140 },
  title: { color: C.brandInk, fontFamily: F.semi, fontSize: 16.7, marginTop: 51, lineHeight: 22, maxWidth: 230 },
  gift: {
    position: 'absolute', right: 28, bottom: -2, width: 64, height: 58, borderWidth: 2, borderColor: C.brandInk,
    borderTopLeftRadius: 4, borderTopRightRadius: 4,
  },
  lid: { position: 'absolute', top: 12, left: -6, right: -6, height: 2, backgroundColor: C.brandInk },
  ribbon: { position: 'absolute', top: 0, bottom: 0, left: 28, width: 4, backgroundColor: C.brandInk },
  bowL: {
    position: 'absolute', top: -16, left: 14, width: 16, height: 13, borderWidth: 2, borderColor: C.brandInk,
    borderRadius: 8, transform: [{ rotate: '-20deg' }],
  },
  bowR: {
    position: 'absolute', top: -16, right: 14, width: 16, height: 13, borderWidth: 2, borderColor: C.brandInk,
    borderRadius: 8, transform: [{ rotate: '20deg' }],
  },
  body: { fontFamily: F.regular, fontSize: 12.5, color: '#55555C', marginTop: 28, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 30 },
  part: {
    fontFamily: F.semi, fontSize: 15, color: '#333', textAlign: 'center', paddingVertical: 6, outlineStyle: 'none',
  } as object,
  slash: { fontFamily: F.regular, fontSize: 15, color: '#B4B4BC', paddingBottom: 8 },
  errorBox: { minHeight: 52, justifyContent: 'center', paddingVertical: 8 },
  error: { fontFamily: F.medium, fontSize: 11.6, color: C.problem, lineHeight: 15 },
  cta: { height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14 },
  skip: { alignSelf: 'center', marginTop: 18, paddingVertical: 6, paddingHorizontal: 16 },
  skipTxt: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
});
