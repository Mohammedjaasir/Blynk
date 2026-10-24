import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestOtp } from '@/blynk/auth/api';
import { setPendingOtp } from '@/blynk/auth/flow';
import { GATE_PARAMS, isFromGate, rememberSkippedLogin } from '@/blynk/auth/gate';
import { authErrorText } from '@/blynk/auth/forms';
import { toE164 } from '@/blynk/auth/phone';
import { getSession, needsRegistration } from '@/blynk/auth/session';
import { LOGIN_WORDS } from '@/blynk/auth/words';
import { AgreeLine } from '@/blynk/legal/PolicyLinks';
import { loginHeroLayout } from '@/blynk/ui/loginHero';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LOGIN_GATE } from '@/blynk/ui/strings';
import { BackIcon } from '@/components/icons';
import { LoginHero } from '@/components/LoginHero';
import { PressScale } from '@/components/ui';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { useKeyboardInset } from '@/lib/keyboard';
import { goBack } from '@/lib/nav';
import { splashHandover } from '@/lib/splash';
import { C, F } from '@/lib/theme';

/*
 * Log in from the profile (the cart has its own login sheet; this is the same step as a screen):
 * a Sri Lankan mobile number, POST /auth/otp/request, then "Verify Details" (/otp), which comes
 * back here's caller once signed in. Refusals arrive in the server's own words: Admin and
 * Inventory numbers sign in with email only, a rider still waiting for approval cannot sign in
 * yet. Riders and Operations staff shop with their number like anyone else.
 *
 * The start gate (`?gate=1`, Flutter SessionGate + LoginScreen): after the launch intro a guest
 * who has not skipped before lands here. There is nothing to go back to, so the back arrow is
 * replaced by "Skip for now", which remembers the choice (the next launch opens on the shop)
 * and opens the shop; a finished sign-in goes on to the shop too. The number field waits for a
 * tap instead of raising the keyboard over the intro's exit.
 *
 * Top: the yellow rider hero (LoginHero, owner's pick 2026-10-14). It takes the height the form
 * leaves and folds to one headline row when the keyboard is up or the window is very short, so
 * the field and Continue stay on screen from 360x640 up.
 */
export default function Login() {
  const insets = useSafeAreaInsets();
  const gate = isFromGate(useLocalSearchParams<{ gate?: string }>().gate);
  const [num, setNum] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const e164 = toE164(num);
  const ready = num.length === LIVE.phoneDigits && !!e164;
  const win = useWindowDimensions();
  const kb = useKeyboardInset();
  // the form's own height (one line taller with an error); a first guess until it is measured
  const [formH, setFormH] = useState(310);
  // web: the window height is already the visual viewport (keyboard off); iOS: take it off here
  const usable = Platform.OS === 'web' ? win.height : win.height - kb;
  const layout = loginHeroLayout({ width: win.width, height: usable, topInset: insets.top, formH });

  // already signed in: nothing to do here
  useEffect(() => {
    // opened by the intro: its cover lifts away over this screen
    splashHandover.release();
    const s = getSession();
    if (s && needsRegistration(s)) router.replace(gate ? { pathname: '/register', params: GATE_PARAMS } : '/register');
    else if (s) router.replace(gate ? '/home' : '/account');
  }, []);

  /** Flutter's Skip: remembered, then the shop (nothing is underneath the gate's login). */
  const skip = () => {
    if (sending) return;
    rememberSkippedLogin();
    Keyboard.dismiss();
    router.replace('/home');
  };

  const submit = () => {
    if (!ready || sending || !e164) return;
    if (DEMO) {
      router.replace({ pathname: '/otp', params: { phone: num } });
      return;
    }
    setSending(true);
    setError(null);
    requestOtp(e164)
      .then((r) => {
        setPendingOtp(e164, r.dev_otp);
        Keyboard.dismiss();
        // replace: once verified, the OTP screen goes back to whoever opened this one
        router.replace({ pathname: '/otp', params: gate ? { phone: e164, ...GATE_PARAMS } : { phone: e164 } });
      })
      .catch((e) => setError(authErrorText(e)))
      .finally(() => setSending(false));
  };

  // the gate's Skip, hard right in the hero's top row (a 48 pt target, Flutter); else a back arrow
  const skipButton = gate ? (
    <PressScale
      onPress={skip}
      style={styles.skip}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityLabel={LOGIN_GATE.skip}
      accessibilityHint={LOGIN_GATE.skipHint}
    >
      <Text style={styles.skipTxt}>{LOGIN_GATE.skip}</Text>
    </PressScale>
  ) : undefined;
  const backButton = gate ? undefined : (
    <PressScale onPress={goBack} style={styles.back} accessibilityRole="button" accessibilityLabel={LOGIN_WORDS.back}>
      <BackIcon size={20} color={C.brandInk} stroke={1.6} />
    </PressScale>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingBottom: kb }}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <LoginHero layout={layout} topInset={insets.top} leading={backButton} trailing={skipButton} />
        <View style={[styles.sheet, layout.overlap ? { marginTop: -layout.overlap, borderTopLeftRadius: 24, borderTopRightRadius: 24 } : null]}>
          <View onLayout={(e) => setFormH(Math.ceil(e.nativeEvent.layout.height) + insets.bottom)} style={styles.form}>
            <View style={{ marginBottom: 16 }}><LanguagePicker compact /></View>
            <Text style={styles.title}>{LOGIN_WORDS.title}</Text>
            <Text style={styles.sub}>{LOGIN_WORDS.sub}</Text>
            <Pressable onPress={() => input.current?.focus()} style={styles.phoneRow}>
              <Text style={styles.cc}>{LIVE.countryFlag}  {LIVE.countryCode}</Text>
              <TextInput
                ref={input}
                autoFocus={!gate}
                value={num}
                onChangeText={(t) => {
                  setNum(t.replace(/\D/g, '').replace(/^0/, '').slice(0, LIVE.phoneDigits));
                  setError(null);
                }}
                onSubmitEditing={submit}
                keyboardType="number-pad"
                autoComplete="tel-national"
                placeholder={LOGIN_WORDS.mobileLabel}
                placeholderTextColor={C.faint}
                style={styles.input}
                maxLength={10}
                accessibilityLabel={LOGIN_WORDS.mobileLabel}
              />
            </Pressable>
            {!!error && <Text style={styles.err} accessibilityRole="alert">{error}</Text>}
            <PressScale disabled={!ready || sending} onPress={submit} haptic scaleTo={0.97}>
              <View style={[styles.cta, { backgroundColor: ready ? C.brand : C.brandSoft }]}>
                <Text style={styles.ctaTxt}>{sending ? LOGIN_WORDS.sending : LOGIN_WORDS.continue}</Text>
              </View>
            </PressScale>
            <Text style={styles.note}>{LOGIN_WORDS.note}</Text>
            <AgreeLine style={{ marginTop: 14 }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { width: 48, height: 48, justifyContent: 'center', paddingLeft: 11 },
  skip: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  skipTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14.5, textDecorationLine: 'underline' },
  sheet: { flex: 1, backgroundColor: '#fff' },
  form: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 14 },
  title: { color: C.brandInk, fontFamily: F.semi, fontSize: 18, lineHeight: 23 },
  sub: { color: C.sub, fontFamily: F.regular, fontSize: 12.5, marginTop: 1, lineHeight: 17 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1.5, borderBottomColor: C.brandInk, marginTop: 22, paddingBottom: 6 },
  cc: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  input: { flex: 1, fontFamily: F.semi, fontSize: 17, color: C.ink, paddingVertical: 6, letterSpacing: 1, outlineStyle: 'none' } as object,
  err: { fontFamily: F.medium, fontSize: 12.5, color: C.problem, marginTop: 10, lineHeight: 17 },
  cta: { marginTop: 22, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14.5 },
  note: { fontFamily: F.regular, fontSize: 12, color: C.sub, textAlign: 'center', marginTop: 14 },
});
