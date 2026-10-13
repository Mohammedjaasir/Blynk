import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { COPY } from '@/demo/cart';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

/*
 * "Verify Details", read off the reference (video 0:58–1:05). The screen cuts in with no
 * transition; the retry line follows ~130 ms later. Local preview only: no code is sent or
 * checked. Six digits switch the pale button to "Verify And Proceed" while it "verifies", keep
 * the number on this device only and return to the cart, as the video does.
 * Live mode (DEMO=false): +94 Sri Lanka, and the copy says plainly that no code is sent; there
 * is no countdown or "Resend" because nothing was sent in the first place.
 */
export default function Otp() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const insets = useSafeAreaInsets();
  const [otp, setOtp] = useState('');
  const [secs, setSecs] = useState(25);
  const input = useRef<TextInput>(null);
  const done = otp.length === 6;

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      cartActions.setPhone(phone ?? '');
      router.back();
    }, 700);
    return () => clearTimeout(t);
  }, [done]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="light" />
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <PressScale onPress={() => router.back()} style={styles.back}><BackIcon size={20} color="#fff" stroke={1.6} /></PressScale>
        <Text style={styles.title}>{COPY.verifyTitle}</Text>
        <Text style={styles.sub}>{DEMO ? COPY.otpSentTo(phone ?? '') : LIVE.otpSentTo(phone ?? '')}</Text>
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
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          style={styles.hidden}
          accessibilityLabel={COPY.enterOtp}
        />
        <View style={styles.retryBox}>
          {!done && !DEMO && <Animated.Text entering={FadeIn.delay(130).duration(1)} style={styles.retry}>{LIVE.otpNote}</Animated.Text>}
          {!done && DEMO && (
            <Animated.Text entering={FadeIn.delay(130).duration(1)} style={styles.retry}>
              {secs > 0 ? COPY.retry(secs) : <Text style={{ color: C.green, fontFamily: F.semi }} onPress={() => setSecs(25)}>Resend OTP</Text>}
            </Animated.Text>
          )}
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaTxt}>{done ? (DEMO ? COPY.verify : LIVE.otpCta) : COPY.enterOtp}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** One OTP cell: digit above a 45 px underline; the cell waiting for input is green and thicker. */
function Slot({ ch, active }: { ch?: string; active: boolean }) {
  const w = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    w.value = withTiming(active ? 1 : 0, { duration: 150 });
  }, [active]);
  const line = useAnimatedStyle(() => ({
    height: 1 + w.value * 1.6,
    backgroundColor: interpolateColor(w.value, [0, 1], ['#DCDCE0', C.green]),
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

/** Yellow outline phone with "XXXXXX", cut off by the header's bottom edge (steady, as in the video). */
function PhoneArt() {
  return (
    <View style={styles.phone}>
      <View style={styles.notch} />
      <Text style={styles.xx}>XXXXXX</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.green, paddingHorizontal: 15, paddingBottom: 23, overflow: 'hidden' },
  back: { marginTop: 22, width: 24, height: 18, justifyContent: 'center', marginLeft: -1 },
  title: { color: '#fff', fontFamily: F.semi, fontSize: 16.7, marginTop: 11, lineHeight: 22 },
  sub: { color: 'rgba(255,255,255,0.92)', fontFamily: F.regular, fontSize: 11.3, marginTop: 1, lineHeight: 16 },
  phone: {
    position: 'absolute', right: 30, bottom: -2, width: 60, height: 74, borderWidth: 2, borderColor: C.yellow,
    borderTopLeftRadius: 9, borderTopRightRadius: 9, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 16,
  },
  notch: { position: 'absolute', top: 6, width: 14, height: 3, borderRadius: 2, backgroundColor: C.yellow },
  xx: { color: C.yellow, fontFamily: F.regular, fontSize: 9.5, letterSpacing: 3, marginRight: -3 },
  label: { fontFamily: F.regular, fontSize: 9.5, color: '#5E5E66', marginTop: 35, lineHeight: 12 },
  slots: { flexDirection: 'row', gap: 11, marginTop: 15 },
  slot: { width: 45, alignItems: 'center' },
  digit: { fontFamily: F.semi, fontSize: 15, color: '#333' },
  underline: { alignSelf: 'stretch', marginTop: 8 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  retryBox: { height: 72, justifyContent: 'center' },
  retry: { fontFamily: F.regular, fontSize: 11.6, color: '#55555C' },
  cta: { height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenSoft },
  ctaTxt: { color: '#fff', fontFamily: F.semi, fontSize: 14 },
});
