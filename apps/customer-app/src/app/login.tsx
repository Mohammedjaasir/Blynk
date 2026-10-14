import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestOtp } from '@/blynk/auth/api';
import { setPendingOtp } from '@/blynk/auth/flow';
import { GATE_PARAMS, isFromGate, rememberSkippedLogin } from '@/blynk/auth/gate';
import { authErrorText } from '@/blynk/auth/forms';
import { toE164 } from '@/blynk/auth/phone';
import { getSession, needsRegistration } from '@/blynk/auth/session';
import { AgreeLine } from '@/blynk/legal/PolicyLinks';
import { LOGIN_GATE } from '@/blynk/ui/strings';
import { BackIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { COPY } from '@/demo/cart';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
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

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top }]}>
        {gate ? (
          <View style={styles.gateRow}>
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
          </View>
        ) : (
          <PressScale onPress={goBack} style={styles.back}><BackIcon size={20} color={C.brandInk} stroke={1.6} /></PressScale>
        )}
        <Text style={styles.title}>{COPY.login}</Text>
        <Text style={styles.sub}>{COPY.loginSub}</Text>
      </View>
      <View style={{ padding: 15 }}>
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
            placeholder={COPY.mobileLabel}
            placeholderTextColor={C.faint}
            style={styles.input}
            maxLength={10}
            accessibilityLabel={COPY.mobileLabel}
          />
        </Pressable>
        {!!error && <Text style={styles.err} accessibilityRole="alert">{error}</Text>}
        <PressScale disabled={!ready || sending} onPress={submit} haptic scaleTo={0.97}>
          <View style={[styles.cta, { backgroundColor: ready ? C.brand : C.brandSoft }]}>
            <Text style={styles.ctaTxt}>{sending ? LIVE.sending : COPY.continue}</Text>
          </View>
        </PressScale>
        <Text style={styles.note}>We send a 6-digit code by SMS to sign you in.</Text>
        <AgreeLine style={{ marginTop: 18 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.brand, paddingHorizontal: 15, paddingBottom: 23 },
  back: { marginTop: 22, width: 24, height: 18, justifyContent: 'center', marginLeft: -1 },
  // the gate's Skip sits where the back arrow would be, hard right; a 48 pt target (Flutter)
  gateRow: { height: 40, marginTop: 4, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginRight: -12 },
  skip: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  skipTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14.5, textDecorationLine: 'underline' },
  title: { color: C.brandInk, fontFamily: F.semi, fontSize: 16.7, marginTop: 11, lineHeight: 22 },
  sub: { color: C.brandInk, fontFamily: F.regular, fontSize: 11.3, marginTop: 1, lineHeight: 16 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1.5, borderBottomColor: C.brandInk, marginTop: 28, paddingBottom: 6 },
  cc: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  input: { flex: 1, fontFamily: F.semi, fontSize: 17, color: C.ink, paddingVertical: 6, letterSpacing: 1, outlineStyle: 'none' } as object,
  err: { fontFamily: F.medium, fontSize: 12.5, color: C.problem, marginTop: 10, lineHeight: 17 },
  cta: { marginTop: 26, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14.5 },
  note: { fontFamily: F.regular, fontSize: 12, color: C.sub, textAlign: 'center', marginTop: 14 },
});
