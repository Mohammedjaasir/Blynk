import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestOtp, verifyOtp } from '@/blynk/auth/api';
import { demoFlow, devOtpFor, returnToCart, setPendingOtp } from '@/blynk/auth/flow';
import { authErrorText, needsNewCode } from '@/blynk/auth/forms';
import { formatPhone } from '@/blynk/auth/phone';
import { needsRegistration, signIn } from '@/blynk/auth/session';
import { BackIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { COPY } from '@/demo/cart';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

/** Live: "Resend OTP" waits this long after each code (as in the Flutter app). */
const RESEND_SECS = 30;

/*
 * "Verify Details", read off the reference (video 0:58–1:05). The screen cuts in with no
 * transition; the retry line follows ~130 ms later.
 * Design mock (DEMO): local preview only, no code is sent or checked. Six digits switch the pale
 * button to "Verify And Proceed" while it "verifies"; the first time on a page load it previews
 * registration (/register, then /birthday), afterwards it returns straight to the cart.
 * Live: the code was sent by POST /auth/otp/request (from the login sheet). Six digits verify it
 * (POST /auth/otp/verify) and sign in; a new account (no name yet) goes on to /register, a
 * returning customer goes back to the cart. "Resend OTP" waits 30 s. A non-production backend
 * returns its code as dev_otp, offered as a tap-to-fill chip; nothing is ever filled without it.
 */
export default function Otp() {
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const insets = useSafeAreaInsets();
  const [otp, setOtp] = useState('');
  const [secs, setSecs] = useState(DEMO ? 25 : RESEND_SECS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState(() => (DEMO ? undefined : devOtpFor(phone)));
  const input = useRef<TextInput>(null);
  const mounted = useRef(true);
  const done = otp.length === 6;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  // design mock: "verify" locally
  useEffect(() => {
    if (!DEMO || !done) return;
    const t = setTimeout(() => {
      if (!demoFlow.registered) {
        router.replace({ pathname: '/register', params: { phone } });
        return;
      }
      cartActions.setPhone(phone);
      router.back();
    }, 700);
    return () => clearTimeout(t);
  }, [done]);

  // live: verify with Blynk
  useEffect(() => {
    if (DEMO || !done) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    verifyOtp(phone, otp)
      .then((r) => {
        const s = signIn(r);
        if (needsRegistration(s)) router.replace('/register');
        else returnToCart();
      })
      .catch((e) => {
        if (!mounted.current) return;
        setError(authErrorText(e));
        setOtp('');
        if (needsNewCode(e)) setSecs(0);
        input.current?.focus();
      })
      .finally(() => { if (mounted.current) setBusy(false); });
  }, [done]);

  const resend = () => {
    if (DEMO) { setSecs(25); return; }
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(LIVE.resending);
    requestOtp(phone)
      .then((r) => {
        setPendingOtp(phone, r.dev_otp);
        if (!mounted.current) return;
        setDevOtp(r.dev_otp);
        setOtp('');
        setSecs(RESEND_SECS);
        setInfo(LIVE.resent);
      })
      .catch((e) => { if (mounted.current) { setInfo(null); setError(authErrorText(e)); } })
      .finally(() => { if (mounted.current) setBusy(false); });
  };

  const back = () => {
    if (busy) return;
    if (router.canGoBack()) router.back();
    else router.replace('/cart');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <PressScale onPress={back} style={styles.back}><BackIcon size={20} color={C.brandInk} stroke={1.6} /></PressScale>
        <Text style={styles.title}>{COPY.verifyTitle}</Text>
        <Text style={styles.sub}>{DEMO ? COPY.otpSentTo(phone) : LIVE.otpSentTo(formatPhone(phone))}</Text>
        <PhoneArt />
      </View>

      <Pressable onPress={() => input.current?.focus()} style={{ paddingHorizontal: 15 }}>
        <Text style={styles.label}>{COPY.enterOtp}</Text>
        <View style={styles.slots}>
          {Array.from({ length: 6 }, (_, i) => (
            <Slot key={i} ch={otp[i]} active={i === otp.length} />
          ))}
        </View>
        <TextInput
          ref={input}
          value={otp}
          editable={!busy}
          onChangeText={(t) => {
            setOtp(t.replace(/\D/g, '').slice(0, 6));
            if (t) setError(null);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          style={styles.hidden}
          accessibilityLabel={COPY.enterOtp}
        />
        <View style={styles.retryBox}>
          {!DEMO && !!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          {!DEMO && !error && !!info && <Text style={styles.retry}>{info}</Text>}
          {!done && !DEMO && (
            <Animated.Text entering={FadeIn.delay(130).duration(1)} style={[styles.retry, error || info ? { marginTop: 6 } : null]}>
              {secs > 0
                ? LIVE.resendIn(secs)
                : <Text style={styles.resend} onPress={resend} accessibilityRole="button">{LIVE.resend}</Text>}
            </Animated.Text>
          )}
          {!done && DEMO && (
            <Animated.Text entering={FadeIn.delay(130).duration(1)} style={styles.retry}>
              {secs > 0 ? COPY.retry(secs) : <Text style={styles.resend} onPress={resend}>Resend OTP</Text>}
            </Animated.Text>
          )}
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaTxt}>{done ? (!DEMO && busy ? LIVE.verifying : COPY.verify) : COPY.enterOtp}</Text>
        </View>
        {!DEMO && !!devOtp && (
          <PressScale onPress={() => { if (!busy) setOtp(devOtp); }} style={styles.devChip} scaleTo={0.96}>
            <Text style={styles.devTxt}>{LIVE.devCode(devOtp)}</Text>
            <Text style={styles.devFill}>{LIVE.devFill}</Text>
          </PressScale>
        )}
      </Pressable>
    </View>
  );
}

/** One OTP cell: digit above a 45 px underline; the cell waiting for input is dark and thicker. */
function Slot({ ch, active }: { ch?: string; active: boolean }) {
  const w = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    w.value = withTiming(active ? 1 : 0, { duration: 150 });
  }, [active]);
  const line = useAnimatedStyle(() => ({
    height: 1 + w.value * 1.6,
    backgroundColor: interpolateColor(w.value, [0, 1], ['#DCDCE0', C.brandInk]),
  }));
  return (
    <View style={styles.slot}>
      <View style={{ height: 22, justifyContent: 'flex-end', alignItems: 'center' }}>
        {!!ch && <Animated.Text entering={FadeIn.duration(120)} style={styles.digit}>{ch}</Animated.Text>}
      </View>
      <Animated.View style={[styles.underline, line]} />
    </View>
  );
}

/** Ink outline phone with "XXXXXX", cut off by the header's bottom edge (steady, as in the video). */
function PhoneArt() {
  return (
    <View style={styles.phone}>
      <View style={styles.notch} />
      <Text style={styles.xx}>XXXXXX</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.brand, paddingHorizontal: 15, paddingBottom: 23, overflow: 'hidden' },
  back: { marginTop: 22, width: 24, height: 18, justifyContent: 'center', marginLeft: -1 },
  title: { color: C.brandInk, fontFamily: F.semi, fontSize: 16.7, marginTop: 11, lineHeight: 22 },
  sub: { color: C.brandInk, fontFamily: F.regular, fontSize: 11.3, marginTop: 1, lineHeight: 16 },
  phone: {
    position: 'absolute', right: 30, bottom: -2, width: 60, height: 74, borderWidth: 2, borderColor: C.brandInk,
    borderTopLeftRadius: 9, borderTopRightRadius: 9, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 16,
  },
  notch: { position: 'absolute', top: 6, width: 14, height: 3, borderRadius: 2, backgroundColor: C.brandInk },
  xx: { color: C.brandInk, fontFamily: F.regular, fontSize: 9.5, letterSpacing: 3, marginRight: -3 },
  label: { fontFamily: F.regular, fontSize: 9.5, color: '#5E5E66', marginTop: 35, lineHeight: 12 },
  slots: { flexDirection: 'row', gap: 11, marginTop: 15 },
  slot: { width: 45, alignItems: 'center' },
  digit: { fontFamily: F.semi, fontSize: 15, color: '#333' },
  underline: { alignSelf: 'stretch', marginTop: 8 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  retryBox: { height: 72, justifyContent: 'center' },
  retry: { fontFamily: F.regular, fontSize: 11.6, color: '#55555C' },
  cta: { height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandSoft },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14 },
  resend: { color: C.brandText, fontFamily: F.bold },
  error: { fontFamily: F.medium, fontSize: 11.6, color: C.problem, lineHeight: 15 },
  devChip: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18,
    backgroundColor: C.brandTint, borderColor: C.brandDeep, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6,
  },
  devTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.brandInk, letterSpacing: 0.3 },
  devFill: { fontFamily: F.regular, fontSize: 10.5, color: C.brandText },
});
