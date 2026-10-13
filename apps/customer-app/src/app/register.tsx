import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/blynk/api/client';
import { applyReferral, getReferral, saveProfile } from '@/blynk/auth/api';
import { demoFlow } from '@/blynk/auth/flow';
import { authErrorText, cleanReferral, NAME_ERROR, NAME_MAX, referralOk, validName } from '@/blynk/auth/forms';
import { formatPhone } from '@/blynk/auth/phone';
import { getSession, needsRegistration } from '@/blynk/auth/session';
import { PressScale } from '@/components/ui';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const R = LIVE.register;

/*
 * First sign-in: the account was created by the OTP verify and has no name yet. Same visual
 * language as "Verify Details" (yellow header, ink type, underlined fields, pill button). There is
 * no back button and no gesture-back: the customer finishes registration to carry on.
 * Live: the optional referral code is applied first (POST /me/referral/apply, shown only when
 * GET /me/referral says enabled and can_apply_code); a refused code keeps the customer here with
 * the reason. Then the name is saved (PATCH /me) and the optional birthday prompt follows.
 * Design mock: no network; Continue keeps the number on this device and previews /birthday.
 */
export default function Register() {
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [showReferral, setShowReferral] = useState(DEMO);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const referralDone = useRef(false);
  const mounted = useRef(true);
  const valid = !!validName(name);
  // the design mock's numbers are the video's (+91), as on its OTP screen
  const shown = DEMO ? (phone ? `+91-${phone}` : '') : formatPhone(getSession()?.user.phone ?? '');

  useEffect(() => {
    mounted.current = true;
    // no hardware back out of registration (Android)
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => { mounted.current = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (DEMO) return;
    const s = getSession();
    // a reload after registration, or a signed-out visit: nothing to register here
    if (!s || !needsRegistration(s)) { router.replace('/cart'); return; }
    getReferral()
      .then((r) => { if (mounted.current) setShowReferral(!!r?.enabled && !!r?.can_apply_code); })
      .catch(() => undefined); // the field is optional: hide it when the info cannot be read
  }, []);

  const en = useSharedValue(0);
  useEffect(() => { en.value = withTiming(valid ? 1 : 0, { duration: 200 }); }, [valid]);
  const btn = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(en.value, [0, 1], [C.brandSoft, C.brand]) }));

  const submit = async () => {
    if (busy) return;
    const full = validName(name);
    if (!full) { setNameError(NAME_ERROR); return; }
    if (code && !referralOk(code)) { setError(R.referralBad); return; }
    Keyboard.dismiss();
    setNameError(null);
    setError(null);
    if (DEMO) {
      demoFlow.registered = true;
      cartActions.setPhone(phone);
      router.replace('/birthday');
      return;
    }
    setBusy(true);
    let stage: 'referral' | 'name' = 'referral';
    try {
      // the referral goes first: a refused code keeps the customer here, name unsaved
      if (showReferral && code && !referralDone.current) {
        await applyReferral(code);
        referralDone.current = true;
      }
      stage = 'name';
      await saveProfile({ full_name: full });
      router.replace('/birthday');
    } catch (e) {
      if (!mounted.current) return;
      const c = e instanceof ApiError ? e.code : undefined;
      if (c === 'UNAUTHENTICATED') router.replace('/cart');
      else if (c === 'VALIDATION_ERROR' && stage === 'referral') setError(R.referralBad);
      else if (c === 'VALIDATION_ERROR') setNameError(NAME_ERROR);
      else setError(authErrorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <Text style={styles.title}>{R.title}</Text>
        {!!shown && <Text style={styles.headSub}>{R.signedInAs(shown)}</Text>}
        <BadgeArt />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: insets.bottom + 30 }}>
        <Text style={styles.heading}>{R.heading}</Text>
        <Text style={styles.sub}>{R.sub}</Text>

        <Field
          label={R.nameLabel}
          value={name}
          placeholder={R.nameHint}
          onChange={(t) => { setName(t.slice(0, NAME_MAX)); setNameError(null); }}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={NAME_MAX}
          autoFocus
          error={nameError}
          onSubmit={() => void submit()}
        />

        {showReferral && (
          <Animated.View entering={FadeIn.duration(160)}>
            <Field
              label={R.referralLabel}
              value={code}
              onChange={(t) => {
                setCode(cleanReferral(t));
                setError(null);
                referralDone.current = false;
              }}
              autoCapitalize="characters"
              maxLength={32}
              helper={R.referralHelp}
              onSubmit={() => void submit()}
            />
          </Animated.View>
        )}

        <View style={styles.errorBox}>
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        </View>

        <PressScale onPress={() => void submit()} disabled={busy} haptic scaleTo={0.96}>
          <Animated.View style={[styles.cta, btn]}>
            <Text style={styles.ctaTxt}>{busy ? R.saving : R.cta}</Text>
          </Animated.View>
        </PressScale>
      </ScrollView>
    </View>
  );
}

/** Label, underlined input (dark and thicker while focused), then the error or helper line. */
function Field({
  label, value, onChange, placeholder, error, helper, autoCapitalize, autoComplete, maxLength, autoFocus, onSubmit,
}: {
  label: string; value: string; onChange: (t: string) => void; placeholder?: string; error?: string | null; helper?: string;
  autoCapitalize?: 'words' | 'characters'; autoComplete?: 'name'; maxLength?: number; autoFocus?: boolean; onSubmit?: () => void;
}) {
  const [focus, setFocus] = useState(false);
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(focus ? 1 : 0, { duration: 150 }); }, [focus]);
  const line = useAnimatedStyle(() => ({
    height: 1 + w.value * 1.6,
    backgroundColor: interpolateColor(w.value, [0, 1], ['#DCDCE0', C.brandInk]),
  }));
  return (
    <View style={{ marginTop: 26 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#B4B4BC"
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        style={styles.input}
        accessibilityLabel={label}
      />
      <Animated.View style={[{ alignSelf: 'stretch' }, line, error ? { backgroundColor: C.problem } : null]} />
      {error ? <Text style={styles.fieldError} accessibilityRole="alert">{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/** Ink outline name badge, cut off by the header's bottom edge (the OTP screen's phone, for a name). */
function BadgeArt() {
  return (
    <View style={styles.badge}>
      <View style={styles.clip} />
      <View style={styles.face} />
      <View style={styles.bar} />
      <View style={[styles.bar, { width: 18, marginTop: 4 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.brand, paddingHorizontal: 15, paddingBottom: 23, overflow: 'hidden' },
  title: { color: C.brandInk, fontFamily: F.semi, fontSize: 16.7, marginTop: 51, lineHeight: 22 },
  headSub: { color: C.brandInk, fontFamily: F.regular, fontSize: 11.3, marginTop: 1, lineHeight: 16 },
  badge: {
    position: 'absolute', right: 30, bottom: -2, width: 60, height: 74, borderWidth: 2, borderColor: C.brandInk,
    borderTopLeftRadius: 9, borderTopRightRadius: 9, alignItems: 'center', paddingTop: 14,
  },
  clip: { position: 'absolute', top: 6, width: 14, height: 3, borderRadius: 2, backgroundColor: C.brandInk },
  face: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.brandInk, marginBottom: 7 },
  bar: { width: 30, height: 2.5, borderRadius: 2, backgroundColor: C.brandInk },
  heading: { fontFamily: F.semi, fontSize: 20, color: C.brandInk, marginTop: 30, lineHeight: 26 },
  sub: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 2, lineHeight: 16 },
  label: { fontFamily: F.regular, fontSize: 11, color: '#5E5E66', lineHeight: 14 },
  input: {
    fontFamily: F.medium, fontSize: 15, color: '#333', paddingVertical: 8, marginTop: 4, outlineStyle: 'none',
  } as object,
  fieldError: { fontFamily: F.medium, fontSize: 11.6, color: C.problem, marginTop: 6, lineHeight: 15 },
  helper: { fontFamily: F.regular, fontSize: 11.3, color: '#6E6E76', marginTop: 6, lineHeight: 15 },
  errorBox: { minHeight: 40, justifyContent: 'center', paddingVertical: 8 },
  error: { fontFamily: F.medium, fontSize: 11.6, color: C.problem, lineHeight: 15 },
  cta: { height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14 },
});
